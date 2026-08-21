import { describe, expect, it, vi } from 'vitest'
import {
  createPrivateTransport,
  iteratePrivateSse,
  privateStatusError,
  readPrivateBytes,
  PrivateTransportError,
} from '../src/private-transport.ts'
import { ANTIGRAVITY_WIRE_ORIGIN } from '../src/wire-identity.ts'

const endpoint = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:streamGenerateContent`

describe('bounded private transport', () => {
  it('parses SSE frames and plain JSON bodies without unbounded buffering', async () => {
    const sse: Array<{ data: string; event?: string }> = []
    for await (const event of iteratePrivateSse(new Response('event: chunk\ndata: {"a":1}\n\ndata: {"b":2}\n\n'))) sse.push(event)
    expect(sse).toEqual([{ event: 'chunk', data: '{"a":1}' }, { data: '{"b":2}' }])

    const plain: Array<{ data: string }> = []
    for await (const event of iteratePrivateSse(new Response('{\n  "ok": true\n}\n'))) plain.push(event)
    expect(plain).toEqual([{ data: '{\n  "ok": true\n}' }])
  })

  it('cancels oversized response reads and maps status without exposing bodies', async () => {
    await expect(readPrivateBytes(new Response('12345'), { maxBytes: 4 })).rejects.toMatchObject({ code: 'response-too-large' })
    expect(privateStatusError(401)).toMatchObject({ code: 'authentication', status: 401 })
    expect(privateStatusError(429)).toMatchObject({ code: 'rate-limited', status: 429 })
    expect(privateStatusError(200)).toBeUndefined()
  })

  it('owns the fixed origin and provider identity while forwarding only bearer authorization', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer access-secret')
      expect(headers.get('host')).toBeNull()
      expect(headers.get('content-length')).toBeNull()
      expect(headers.get('transfer-encoding')).toBeNull()
      return new Response('{}', { status: 200 })
    })
    const transport = createPrivateTransport({ fetchImpl })
    await expect(transport.request({ url: endpoint, accessToken: 'access-secret', body: '{}' })).resolves.toMatchObject({ status: 200 })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(endpoint)
  })

  it('marks response-header timeouts as not accepted and cancellation as terminal', async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}))
    const transport = createPrivateTransport({ fetchImpl, responseHeaderTimeoutMs: 5 })
    await expect(transport.request({ url: endpoint, accessToken: 'token', body: '{}' })).rejects.toMatchObject({ code: 'timeout', accepted: false })

    const controller = new AbortController()
    controller.abort()
    await expect(transport.request({ url: endpoint, accessToken: 'token', body: '{}', signal: controller.signal })).rejects.toBeInstanceOf(PrivateTransportError)
  })
})
