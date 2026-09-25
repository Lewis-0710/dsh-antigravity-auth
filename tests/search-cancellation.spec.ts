import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const socketState = vi.hoisted(() => ({
  feeds: [] as Array<(chunk: Uint8Array | null) => void>,
  unhandledErrors: 0,
}))

vi.mock('node:tls', async () => {
  const { Duplex } = await vi.importActual<typeof import('node:stream')>('node:stream')
  class PendingTlsSocket extends Duplex {
    override _read(): void {}

    override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
      callback()
    }

    override emit(event: string | symbol, ...args: unknown[]): boolean {
      if (event === 'error' && this.listenerCount('error') === 0) {
        socketState.unhandledErrors += 1
        return false
      }
      return super.emit(event, ...args)
    }
  }
  return {
    connect: vi.fn(() => {
      const socket = new PendingTlsSocket()
      socketState.feeds.push(chunk => { socket.push(chunk) })
      queueMicrotask(() => { socket.emit('secureConnect') })
      return socket
    }),
  }
})

import { AntigravitySearchProvider } from '../src/search.ts'

const proxyKeys = ['NO_PROXY', 'no_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'] as const
const originalProxy = Object.fromEntries(proxyKeys.map(key => [key, process.env[key]]))

beforeEach(() => {
  socketState.feeds = []
  socketState.unhandledErrors = 0
  process.env.NO_PROXY = 'daily-cloudcode-pa.googleapis.com'
  delete process.env.no_proxy
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'] as const) delete process.env[key]
})

afterEach(() => {
  for (const key of proxyKeys) {
    const value = originalProxy[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

it('keeps the Host socket error handled when one failed search cancels three pending searches', async () => {
  const provider = new AntigravitySearchProvider({
    auth: { credential: async () => ({ accessToken: 'offline', refreshToken: 'offline', expiresAt: Date.now() + 60_000, projectId: 'offline' }) },
  })
  const controllers = Array.from({ length: 4 }, () => new AbortController())
  const queries = ['OpenAI 官网', 'DeepSeek Harness GitHub', 'Apple macOS', 'Figma 官网']
  const results = queries.map((query, index) => provider.search({ query }, controllers[index]!.signal).then(
    value => value,
    (error: unknown) => error,
  ))
  await vi.waitFor(() => { expect(socketState.feeds).toHaveLength(4) })
  const firstSocket = socketState.feeds[0]!
  firstSocket(Buffer.from(
    'HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n'
    + 'data: {"response":{"parts":[{"text":"ungrounded"}]}}\n\n'
    + 'data: [DONE]\n\n',
    'latin1',
  ))
  firstSocket(null)
  await expect(results[0]).resolves.toMatchObject({ code: 'ANTIGRAVITY_SEARCH_NO_SOURCES' })
  for (const controller of controllers.slice(1)) controller.abort()
  for (const result of results.slice(1)) await expect(result).resolves.toMatchObject({ code: 'ANTIGRAVITY_SEARCH_CANCELLED' })
  await new Promise<void>(resolve => { setImmediate(resolve) })
  expect(socketState.unhandledErrors).toBe(0)
})
