/**
 * A capacity-exhausted 503 is a momentary tier blip, not a bad request: the
 * adapter must wait it out and resend rather than failing the whole turn, and
 * it must still give up after its bounded retry budget.
 */
import { describe, expect, it, vi } from 'vitest'
import { AntigravityAdapter, ANTIGRAVITY_PROVIDER } from '../src/llm-adapter.ts'
import type { HostCredential } from '../src/credential-coordinator.ts'
import type { PrivateTransportRequest } from '../src/private-transport.ts'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'

const credential = (): HostCredential => ({
  accessToken: 'opaque-test-value',
  refreshToken: 'refresh',
  expiresAt: Date.parse('2030-01-01T00:00:00.000Z'),
  projectId: 'project-id',
})

const CAPACITY_BODY = JSON.stringify({
  error: {
    code: 503,
    message: 'No capacity available for model gemini-3.8-flash-high on the server',
    status: 'UNAVAILABLE',
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'MODEL_CAPACITY_EXHAUSTED', metadata: { model: 'gemini-3.8-flash-high' } }],
  },
})

/**
 * The same structural capacity verdict carried on HTTP 429. Rate limiting is a
 * quota verdict for the caller to surface, not a tier blip to resend: the retry
 * must be pinned to 503 and must not fire on this body.
 */
const RATE_LIMITED_CAPACITY_BODY = JSON.stringify({
  error: {
    code: 429,
    message: 'No capacity available for model gemini-3.8-flash-high on the server',
    status: 'RESOURCE_EXHAUSTED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'MODEL_CAPACITY_EXHAUSTED', metadata: { model: 'gemini-3.8-flash-high' } }],
  },
})

const message = (text: string): Message => ({
  id: 'message-id' as never,
  role: 'user',
  source: { kind: 'user' },
  content: [{ type: 'text', text }],
})

const options = (): GenerateOptions => ({
  provider: ANTIGRAVITY_PROVIDER,
  model: 'antigravity-gemini-3.8-flash',
  messages: [message('hello')],
})

async function collect(adapter: AntigravityAdapter, input: GenerateOptions) {
  const chunks = []
  for await (const chunk of adapter.stream(input)) chunks.push(chunk)
  return chunks
}

describe('Antigravity capacity-exhausted retry', () => {
  it('waits out a MODEL_CAPACITY_EXHAUSTED 503 and completes on the resend', async () => {
    const request = vi.fn(async (_input: PrivateTransportRequest) => {
      if (request.mock.calls.length === 1) {
        return new Response(CAPACITY_BODY, { status: 503, headers: { 'content-type': 'application/json' } })
      }
      return new Response('data: {"response":{"parts":[{"text":"recovered"}],"finishReason":"STOP"}}\n\n')
    })
    const adapter = new AntigravityAdapter({
      auth: { credential: async () => credential() },
      transport: { request },
    })

    const chunks = await collect(adapter, options())
    expect(request).toHaveBeenCalledTimes(2)
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', text: 'recovered' }))
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('gives up after the bounded retry budget instead of retrying forever', async () => {
    const request = vi.fn(async (_input: PrivateTransportRequest) => new Response(CAPACITY_BODY, { status: 503 }))
    const adapter = new AntigravityAdapter({
      auth: { credential: async () => credential() },
      transport: { request },
    })

    await expect(collect(adapter, options())).rejects.toMatchObject({ code: 'UPSTREAM' })
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('does not retry an ordinary 503 that is not a capacity verdict', async () => {
    const request = vi.fn(async (_input: PrivateTransportRequest) => new Response('{"error":{"code":503,"status":"UNAVAILABLE"}}', { status: 503 }))
    const adapter = new AntigravityAdapter({
      auth: { credential: async () => credential() },
      transport: { request },
    })

    await expect(collect(adapter, options())).rejects.toMatchObject({ code: 'UPSTREAM' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not retry a 429 whose body carries the capacity marker', async () => {
    // The capacity marker alone must not widen the retry to rate limiting: a
    // 429 stays a single request and surfaces as RATE_LIMIT for the caller.
    const request = vi.fn(async (_input: PrivateTransportRequest) => {
      if (request.mock.calls.length === 1) {
        return new Response(RATE_LIMITED_CAPACITY_BODY, { status: 429, headers: { 'content-type': 'application/json' } })
      }
      return new Response('data: {"response":{"parts":[{"text":"recovered"}],"finishReason":"STOP"}}\n\n')
    })
    const adapter = new AntigravityAdapter({
      auth: { credential: async () => credential() },
      transport: { request },
    })

    await expect(collect(adapter, options())).rejects.toMatchObject({ code: 'RATE_LIMIT', failure: { status: 429 } })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not retry a 500 whose body carries the capacity marker', async () => {
    // Pinning to 503 must not be implemented as "any 5xx": a genuine server
    // fault that quotes the capacity marker is still not a tier blip.
    const request = vi.fn(async (_input: PrivateTransportRequest) => new Response(CAPACITY_BODY, { status: 500 }))
    const adapter = new AntigravityAdapter({
      auth: { credential: async () => credential() },
      transport: { request },
    })

    await expect(collect(adapter, options())).rejects.toMatchObject({ code: 'UPSTREAM' })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
