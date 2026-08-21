import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { AntigravityAdapter, ANTIGRAVITY_PROVIDER, buildAntigravityGeneratePayload } from '../src/llm-adapter.ts'
import type { HostCredential } from '../src/credential-coordinator.ts'
import { PrivateTransportError, type PrivateTransportRequest } from '../src/private-transport.ts'

const credential = (token: string): HostCredential => ({
  accessToken: token,
  refreshToken: 'refresh',
  expiresAt: Date.parse('2030-01-01T00:00:00.000Z'),
  projectId: 'project-id',
})

const liveCatalog = () => new Response(JSON.stringify({
  models: { 'gemini-3.7-flash-medium': { displayName: 'Gemini live' } },
}))

const message = (text: string): Message => ({
  id: 'message-id' as never,
  role: 'user',
  content: [{ type: 'text', text }],
  source: { kind: 'user' },
})

const options = (overrides: Partial<GenerateOptions> = {}): GenerateOptions => ({
  provider: ANTIGRAVITY_PROVIDER,
  model: 'antigravity-gemini-3.7-flash',
  messages: [message('hello')],
  ...overrides,
})

async function collect(chunks: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const output: StreamChunk[] = []
  for await (const chunk of chunks) output.push(chunk)
  return output
}

describe('Antigravity LLM adapter', () => {
  it('streams bounded text, usage, finish, and replay metadata through the public LLM vocabulary', async () => {
    const transport = {
      request: vi.fn(async ({ url }: { url: string }) => url.endsWith(':fetchAvailableModels')
        ? liveCatalog()
        : new Response(
            'data: {"response":{"parts":[{"text":"hello","thoughtSignature":"provider-sig"}]}}\n\n'
            + 'data: {"response":{"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3},"finishReason":"STOP"}}\n\n'
            + 'data: [DONE]\n\n',
          )),
    }
    const adapter = new AntigravityAdapter({ auth: { credential: vi.fn(async () => credential('access')) }, transport })
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream(options())) chunks.push(chunk)
    expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'hello')).toBe(true)
    expect(chunks).toContainEqual({ type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } })
    const finish = chunks.at(-1)
    expect(finish?.type).toBe('finish')
    if (finish?.type === 'finish') expect(finish.replayState).toMatchObject({ response: { provider: ANTIGRAVITY_PROVIDER }, blocks: [{ kind: 'text', signature: 'provider-sig' }] })
  })

  it.each([
    {
      family: 'Gemini', model: 'antigravity-gemini-3.7-flash', wireModel: 'gemini-3.7-flash-medium', errorCode: 'SAFETY',
      event: '{"response":{"parts":[{"text":"gemini-reason","thought":true},{"text":"gemini-answer"},{"functionCall":{"id":"gemini-call","name":"gemini_lookup","args":{"q":"g"}}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3},"finishReason":"STOP"}}',
    },
    {
      family: 'Claude', model: 'antigravity-claude-sonnet-4-6-thinking', wireModel: 'claude-sonnet-4-6', errorCode: 'RESOURCE_EXHAUSTED',
      event: '{"response":{"parts":[{"text":"claude-reason","thinking":true},{"text":"claude-answer"},{"function_call":{"id":"claude-call","name":"claude_lookup","args":{"q":"c"}}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3},"finishReason":"STOP"}}',
    },
    {
      family: 'GPT-OSS', model: 'antigravity-gpt-oss-120b-medium', wireModel: 'gpt-oss-120b-medium', errorCode: 'INVALID_ARGUMENT',
      event: '{"response":{"parts":[{"text":"gpt-reason","reasoning":true},{"text":"gpt-answer"},{"functionCall":{"id":"gpt-call","name":"gpt_lookup","args":{"q":"o"}}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3},"finishReason":"STOP"}}',
    },
  ])('keeps $family text, reasoning, tool, usage, finish, and error fixtures independent', async fixture => {
    const request = vi.fn(async (input: PrivateTransportRequest) => {
      expect(JSON.parse(String(input.body))).toMatchObject({ model: fixture.wireModel })
      return new Response(`data: ${fixture.event}\n\n`)
    })
    const success = new AntigravityAdapter({
      auth: { credential: vi.fn(async () => credential('opaque-test-value')) },
      transport: { request },
    })
    const chunks = await collect(success.stream(options({ model: fixture.model })))
    expect(chunks.some(chunk => chunk.type === 'reasoning-delta')).toBe(true)
    expect(chunks.some(chunk => chunk.type === 'text-delta')).toBe(true)
    expect(chunks.some(chunk => chunk.type === 'tool-call-delta')).toBe(true)
    expect(chunks).toContainEqual({ type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } })
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })

    const failed = new AntigravityAdapter({
      auth: { credential: vi.fn(async () => credential('opaque-test-value')) },
      transport: { request: vi.fn(async () => new Response(`data: {"error":{"status":400,"code":"${fixture.errorCode}"}}\n\n`)) },
    })
    expect((await collect(failed.stream(options({ model: fixture.model })))).at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: fixture.errorCode } },
    })
  })

  it('replays exactly once after a pre-delta authentication response', async () => {
    const transport = {
      request: vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(new Response('data: {"response":{"parts":[{"text":"ok"}],"finishReason":"STOP"}}\n\n')),
    }
    const auth = {
      credential: vi.fn()
        .mockResolvedValueOnce(credential('old'))
        .mockResolvedValueOnce(credential('new')),
    }
    const adapter = new AntigravityAdapter({ auth, transport })
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream(options())) chunks.push(chunk)
    expect(transport.request).toHaveBeenCalledTimes(2)
    expect(auth.credential).toHaveBeenCalledTimes(2)
    expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'ok')).toBe(true)
  })

  it('intersects the pinned snapshot with the authenticated live model catalog', async () => {
    const transport = {
      request: vi.fn(async (_input: PrivateTransportRequest) => new Response(JSON.stringify({
        models: {
          'gemini-3.7-flash-medium': { displayName: 'Gemini live' },
          'provider-unknown-model': { displayName: 'Unknown' },
        },
      }))),
    }
    const adapter = new AntigravityAdapter({ auth: { credential: vi.fn(async () => credential('access')) }, transport })

    const models = await adapter.listModels(ANTIGRAVITY_PROVIDER)

    expect(models.map(model => model.id)).toEqual(['antigravity-gemini-3.7-flash'])
    expect(transport.request).toHaveBeenCalledOnce()
    expect(transport.request.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
      accessToken: 'access',
    })
    expect(JSON.parse(String(transport.request.mock.calls[0]?.[0].body))).toEqual({ project: 'project-id' })
  })

  it('projects snapshot, live-available, unavailable, refresh-failed, and protocol-drift catalog states safely', async () => {
    const live = new AntigravityAdapter({
      auth: { credential: vi.fn(async () => credential('access')) },
      transport: { request: vi.fn(async () => liveCatalog()) },
    })
    expect(live.catalogSnapshot()).toMatchObject({ state: 'snapshot' })
    const liveView = await live.modelCatalog()
    expect(liveView.state).toBe('live-available')
    expect(liveView.models.find(model => model.id === 'antigravity-gemini-3.7-flash')?.state).toBe('live-available')
    expect(liveView.models.some(model => model.state === 'unavailable')).toBe(true)

    const rateLimited = new AntigravityAdapter({
      auth: { credential: vi.fn(async () => credential('access')) },
      transport: { request: vi.fn(async () => new Response('', { status: 429 })) },
    })
    await expect(rateLimited.modelCatalog()).resolves.toMatchObject({ state: 'refresh-failed' })

    const drifted = new AntigravityAdapter({
      auth: { credential: vi.fn(async () => credential('access')) },
      transport: { request: vi.fn(async () => new Response(JSON.stringify({ models: [] }))) },
    })
    await expect(drifted.modelCatalog()).resolves.toMatchObject({ state: 'protocol-drift' })
  })

  it('keeps exact pinned-model resolution independent from the advisory live catalog', async () => {
    const transport = { request: vi.fn(async () => new Response(JSON.stringify({ models: {} }))) }
    const adapter = new AntigravityAdapter({ auth: { credential: vi.fn(async () => credential('access')) }, transport })

    await expect(adapter.resolveModel(ANTIGRAVITY_PROVIDER, 'antigravity-gemini-3.7-flash')).resolves.toMatchObject({
      provider: ANTIGRAVITY_PROVIDER,
      id: 'antigravity-gemini-3.7-flash',
    })
    expect(transport.request).not.toHaveBeenCalled()
  })

  it('refreshes credentials once when live catalog authentication expires', async () => {
    const auth = {
      credential: vi.fn()
        .mockResolvedValueOnce(credential('old'))
        .mockResolvedValueOnce(credential('new')),
    }
    const transport = {
      request: vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(liveCatalog()),
    }
    const adapter = new AntigravityAdapter({ auth, transport })

    await expect(adapter.listModels(ANTIGRAVITY_PROVIDER)).resolves.toHaveLength(1)
    expect(auth.credential).toHaveBeenNthCalledWith(2, undefined, { forceRefresh: true })
    expect(transport.request).toHaveBeenCalledTimes(2)
  })

  it('fails catalog refresh closed on rate limiting or schema drift instead of returning the snapshot', async () => {
    const rateRequest = vi.fn(async () => new Response('', { status: 429 }))
    const rateLimited = new AntigravityAdapter({
      auth: { credential: vi.fn(async () => credential('access')) },
      transport: { request: rateRequest },
    })
    await expect(rateLimited.listModels(ANTIGRAVITY_PROVIDER)).rejects.toMatchObject({ code: 'RATE_LIMIT' })
    await expect(rateLimited.listModels(ANTIGRAVITY_PROVIDER)).rejects.toMatchObject({ code: 'RATE_LIMIT' })
    expect(rateRequest).toHaveBeenCalledOnce()

    const drifted = new AntigravityAdapter({
      auth: { credential: vi.fn(async () => credential('access')) },
      transport: { request: vi.fn(async () => new Response(JSON.stringify({ models: [] }))) },
    })
    await expect(drifted.listModels(ANTIGRAVITY_PROVIDER)).rejects.toMatchObject({ code: 'PROTOCOL_DRIFT' })
  })

  it('replays tool results with the original function name correlated by call id', () => {
    const toolCallId = 'call-7'
    const request = options({ messages: [
      {
        id: 'assistant-1',
        role: 'assistant',
        source: { kind: 'model', provider: ANTIGRAVITY_PROVIDER, model: 'antigravity-gemini-3.7-flash' },
        content: [{ type: 'tool-call', id: toolCallId, name: 'lookup_weather', arguments: '{"city":"Paris"}' }],
      } as Message,
      {
        id: 'tool-1',
        role: 'user',
        source: { kind: 'tool', callId: toolCallId },
        content: [{ type: 'tool-result', toolCallId, content: [{ type: 'text', text: 'sunny' }] }],
      } as Message,
    ] })

    const payload = buildAntigravityGeneratePayload(request, credential('access'))
    const contents = (payload.request as { contents: Array<{ parts: unknown[] }> }).contents

    expect(contents[1]?.parts).toEqual([{ functionResponse: { name: 'lookup_weather', response: { content: 'sunny' } } }])
  })

  it('assembles fragmented provider function names in the final public tool block', async () => {
    const transport = {
      request: vi.fn(async ({ url }: PrivateTransportRequest) => url.endsWith(':fetchAvailableModels')
        ? liveCatalog()
        : new Response(
            'data: {"response":{"parts":[{"functionCall":{"id":"call-9","name":"lookup_","args":"{\\"city\\":"}}]}}\n\n'
            + 'data: {"response":{"parts":[{"functionCall":{"id":"call-9","name":"weather","args":"\\"Paris\\"}"}}],"finishReason":"STOP"}}\n\n',
          )),
    }
    const adapter = new AntigravityAdapter({ auth: { credential: vi.fn(async () => credential('access')) }, transport })

    const chunks = await collect(adapter.stream(options()))
    const end = chunks.find(chunk => chunk.type === 'block-end')

    expect(end).toMatchObject({ block: { type: 'tool-call', id: 'call-9', name: 'lookup_weather', arguments: '{"city":"Paris"}' } })
  })

  it('fails Gate 0 closed on secondary-attribution rejection without retrying', async () => {
    const request = vi.fn(async () => {
      throw new PrivateTransportError('attribution-rejected', 'provider-secret-body', { accepted: false, status: 403 })
    })
    const adapter = new AntigravityAdapter({ auth: { credential: vi.fn(async () => credential('access-secret')) }, transport: { request } })

    const operation = adapter.listModels(ANTIGRAVITY_PROVIDER)
    await expect(operation).rejects.toMatchObject({ code: 'GATE_0_ATTRIBUTION' })
    await expect(operation).rejects.not.toThrow(/access-secret|provider-secret-body/u)
    expect(request).toHaveBeenCalledOnce()
  })

  it('rejects unknown models and keeps request payloads free of access tokens', async () => {
    const adapter = new AntigravityAdapter({ auth: { credential: vi.fn(async () => credential('access-secret')) }, transport: { request: vi.fn() } })
    await expect(adapter.resolveModel(ANTIGRAVITY_PROVIDER, 'unknown-model')).rejects.toMatchObject({ code: 'INVALID_MODEL' })
    const payload = buildAntigravityGeneratePayload(options({ tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }] }), credential('access-secret'))
    const encoded = JSON.stringify(payload)
    expect(encoded).toContain('project-id')
    expect(encoded).not.toContain('access-secret')
    expect(encoded).toContain('functionDeclarations')
  })
})
