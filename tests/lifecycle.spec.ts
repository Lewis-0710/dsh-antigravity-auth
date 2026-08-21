import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyAuth } from '../src/index.ts'
import { apply as applyImage } from '../src/image.ts'
import { apply as applySearch } from '../src/search.ts'
import { apply as applyVideo } from '../src/video.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('bootstrap lifecycle boundary', () => {
  it('mounts the Host row without OAuth, private transport, timers, or listeners', () => {
    const dispose = vi.fn()
    const handle = vi.fn((_channel: string, _handler: unknown, _options: unknown) => dispose)
    const inject = vi.fn((_dependencies: readonly string[], callback: (ctx: unknown) => unknown) => callback({
      connection: { rpc: { handle } },
    }))
    const fetch = vi.fn()
    globalThis.fetch = fetch as typeof globalThis.fetch
    const setTimeout = vi.spyOn(globalThis, 'setTimeout')

    applyAuth({ inject } as never)

    expect(fetch).not.toHaveBeenCalled()
    expect(setTimeout).not.toHaveBeenCalled()
    expect(handle).toHaveBeenCalledOnce()
    expect(handle.mock.calls[0]?.[0]).toBe('/antigravity-auth')
    expect(handle.mock.calls[0]?.[2]).toEqual({ authority: 'loopback' })

    const registration = handle.mock.results[0]?.value as (() => void) | undefined
    registration?.()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('releases the actual Host RPC registration when a Cordis context is disposed', async () => {
    const dispose = vi.fn()
    const handle = vi.fn((_channel: string, _handler: unknown, _options: unknown) => dispose)
    const ctx = new Context()
    const unprovide = ctx.provide('connection', { rpc: { handle } })
    try {
      applyAuth(ctx)
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(handle).toHaveBeenCalledOnce()
    } finally {
      await ctx.fiber.dispose()
      await unprovide()
    }
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('keeps each later capability row independently mountable and inert', () => {
    const fetch = vi.fn()
    globalThis.fetch = fetch as typeof globalThis.fetch

    expect(() => applySearch()).not.toThrow()
    expect(() => applyImage()).not.toThrow()
    expect(() => applyVideo()).not.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})
