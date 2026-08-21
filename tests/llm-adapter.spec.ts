import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { AntigravityAdapter, ANTIGRAVITY_PROVIDER, buildAntigravityGeneratePayload } from '../src/llm-adapter.ts'
import type { HostCredential } from '../src/credential-coordinator.ts'

const credential = (token: string): HostCredential => ({
  accessToken: token,
  refreshToken: 'refresh',
  expiresAt: Date.parse('2030-01-01T00:00:00.000Z'),
  projectId: 'project-id',
})

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

describe('Antigravity LLM adapter', () => {
  it('streams bounded text, usage, finish, and replay metadata through the public LLM vocabulary', async () => {
    const transport = {
      request: vi.fn(async () => new Response(
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

  it('replays exactly once after a pre-delta authentication response', async () => {
    const transport = {
      request: vi.fn()
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(new Response('data: {"response":{"parts":[{"text":"ok"}],"finishReason":"STOP"}}\n\n')),
    }
    const auth = { credential: vi.fn().mockResolvedValueOnce(credential('old')).mockResolvedValueOnce(credential('new')) }
    const adapter = new AntigravityAdapter({ auth, transport })
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream(options())) chunks.push(chunk)
    expect(transport.request).toHaveBeenCalledTimes(2)
    expect(auth.credential).toHaveBeenCalledTimes(2)
    expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'ok')).toBe(true)
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
