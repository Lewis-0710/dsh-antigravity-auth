import { describe, expect, it, vi } from 'vitest'
import {
  createAntigravityAuthRpcClient,
  parseStatusResult,
} from '../src/rpc-contract.ts'
import { handleAntigravityAuthRpc } from '../src/rpc.ts'
import { createBootstrapStatusService } from '../src/bootstrap-service.ts'
import { createStatusView } from '../src/status.ts'

const signal = new AbortController().signal

async function request(endpoint: string, payload: unknown) {
  return handleAntigravityAuthRpc(createBootstrapStatusService(), endpoint, payload, signal)
}

function loginFixture() {
  return {
    started: true as const,
    phase: 'pending' as const,
    authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?state=${'a'.repeat(43)}`,
    expiresAt: '2026-08-21T00:00:00.000Z',
  }
}

describe('Antigravity login RPC', () => {
  it('returns value-free plugin, login, and gate status', async () => {
    const result = await request('status', {})

    expect(result).toEqual({
      ok: true,
      value: {
        status: {
          pluginId: 'dsh-antigravity-auth',
          phase: 'bootstrap',
          privateSelfUse: true,
          singleAccount: true,
          riskAcknowledgementRequired: true,
          riskAcknowledged: false,
          login: { phase: 'idle', configured: false, projectAvailable: false },
          capabilities: [
            { id: 'auth-llm', state: 'poc-pending', reasonCode: 'login-not-implemented' },
            { id: 'search', state: 'poc-pending', reasonCode: 'gate-not-run' },
            { id: 'image', state: 'poc-pending', reasonCode: 'gate-not-run' },
            { id: 'video', state: 'poc-pending', reasonCode: 'gate-not-run' },
          ],
        },
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/token|secret|cookie/i)
  })

  it('requires a risk acknowledgement before login can begin', async () => {
    const service = createBootstrapStatusService()
    const result = await handleAntigravityAuthRpc(service, 'login', {}, signal)

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'risk-acknowledgement-required' },
    })
    await service.dispose()
  })

  it('returns an authorization URL only after acknowledgement and supports cancellation', async () => {
    const listener = { close: vi.fn(async () => {}) }
    const service = createBootstrapStatusService({
      flowOptions: { listenerFactory: { listen: vi.fn(async () => listener) } },
    })

    expect(await handleAntigravityAuthRpc(service, 'acknowledge-risk', { acknowledge: true }, signal)).toEqual({
      ok: true,
      value: { acknowledged: true },
    })
    const login = await handleAntigravityAuthRpc(service, 'login', {}, signal)
    expect(login).toMatchObject({ ok: true, value: { started: true, phase: 'pending' } })
    expect(JSON.stringify(login)).not.toMatch(/verifier|client_secret|token/i)
    expect(await handleAntigravityAuthRpc(service, 'cancel', {}, signal)).toEqual({
      ok: true,
      value: { phase: 'cancelled', errorCode: 'cancelled' },
    })
    expect(listener.close).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('rejects malformed payloads and unknown endpoints without evaluating the service', async () => {
    const service = createBootstrapStatusService()
    const status = vi.spyOn(service, 'status')
    for (const [endpoint, payload] of [
      ['status', { extra: true }],
      ['acknowledge-risk', { acknowledge: true, extra: true }],
      ['login', { callbackUrl: 'secret' }],
      ['cancel', { extra: true }],
      ['complete-callback', { callbackUrl: '' }],
      ['private', {}],
    ] as const) {
      const result = await handleAntigravityAuthRpc(service, endpoint, payload, signal)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('bad-request')
    }
    expect(status).not.toHaveBeenCalled()
    await service.dispose()
  })

  it('validates the browser response as a closed, value-free status schema', () => {
    const valid = {
      status: {
        ...createStatusView(false, { phase: 'idle', configured: false, projectAvailable: false }),
      },
    }
    expect(parseStatusResult(valid)).toMatchObject({ pluginId: 'dsh-antigravity-auth' })
    expect(parseStatusResult({ ...valid, leaked: 'value' })).toBeUndefined()
    expect(parseStatusResult({ ...valid, status: { ...valid.status, login: { ...valid.status.login, authorizationUrl: 'http://evil.test' } } })).toBeUndefined()
  })

  it('keeps the browser face typed and forwards only fixed operations', async () => {
    const status = createStatusView(false, { phase: 'idle', configured: false, projectAvailable: false })
    const rpc = {
      call: vi.fn()
        .mockResolvedValueOnce({ ok: true, value: { status } })
        .mockResolvedValueOnce({ ok: true, value: { acknowledged: true } })
        .mockResolvedValueOnce({ ok: true, value: loginFixture() })
        .mockResolvedValueOnce({ ok: true, value: { phase: 'cancelled', errorCode: 'cancelled' } })
        .mockResolvedValueOnce({ ok: true, value: { completed: false, phase: 'failed', errorCode: 'oauth-error' } }),
    }
    const client = createAntigravityAuthRpcClient(rpc)

    await client.status()
    await client.acknowledgeRisk()
    await client.login()
    await client.cancelLogin()
    await client.completeCallback('http://localhost:51121/oauth-callback?state=state&code=code')

    expect(rpc.call.mock.calls.map(call => call.slice(0, 3))).toEqual([
      ['/antigravity-auth', 'status', {}],
      ['/antigravity-auth', 'acknowledge-risk', { acknowledge: true }],
      ['/antigravity-auth', 'login', {}],
      ['/antigravity-auth', 'cancel', {}],
      ['/antigravity-auth', 'complete-callback', { callbackUrl: 'http://localhost:51121/oauth-callback?state=state&code=code' }],
    ])
  })
})
