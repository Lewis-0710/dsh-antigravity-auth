import { describe, expect, it, vi } from 'vitest'
import {
  createAntigravityAuthRpcClient,
  parseStatusResult,
} from '../src/rpc-contract.ts'
import { handleAntigravityAuthRpc } from '../src/rpc.ts'
import { createMemoryAuthStore } from '../src/auth-store.ts'
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
          credential: { state: 'logged-out', configured: false },
          revoke: { state: 'idle' },
          capabilities: [
            { id: 'auth-llm', state: 'poc-pending', reasonCode: 'llm-not-implemented' },
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

  it('keeps local logout separate from confirmed grant revocation', async () => {
    const localStore = createMemoryAuthStore()
    await localStore.commit({ refreshToken: 'local-refresh', projectId: 'project-id' })
    const localRevoke = vi.fn(async () => {})
    const localService = createBootstrapStatusService({ store: localStore, credentialOptions: { revokeGrant: localRevoke } })
    await expect(handleAntigravityAuthRpc(localService, 'logout', {}, signal)).resolves.toEqual({ ok: true, value: { state: 'logged-out' } })
    await expect(localStore.read()).resolves.toBeUndefined()
    expect(localRevoke).not.toHaveBeenCalled()
    await localService.dispose()

    const revokeStore = createMemoryAuthStore()
    await revokeStore.commit({ refreshToken: 'grant-refresh', projectId: 'project-id' })
    const revoke = vi.fn(async () => {})
    const revokeService = createBootstrapStatusService({ store: revokeStore, credentialOptions: { revokeGrant: revoke } })
    await expect(handleAntigravityAuthRpc(revokeService, 'revoke', { confirmed: false }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    await expect(handleAntigravityAuthRpc(revokeService, 'revoke', { confirmed: true }, signal)).resolves.toEqual({ ok: true, value: { state: 'revoked' } })
    expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ token: 'grant-refresh', signal: expect.any(AbortSignal) }))
    await expect(revokeStore.read()).resolves.toBeUndefined()
    await revokeService.dispose()
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
      ['logout', { extra: true }],
      ['revoke', { confirmed: false }],
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
        ...createStatusView(
          false,
          { phase: 'idle', configured: false, projectAvailable: false },
          { state: 're-login-required', configured: true, errorCode: 'invalid-grant' },
          { state: 'failed', errorCode: 'storage' },
        ),
      },
    }
    expect(parseStatusResult(valid)).toMatchObject({ pluginId: 'dsh-antigravity-auth' })
    expect(parseStatusResult({ ...valid, leaked: 'value' })).toBeUndefined()
    expect(parseStatusResult({ ...valid, status: { ...valid.status, login: { ...valid.status.login, authorizationUrl: 'http://evil.test' } } })).toBeUndefined()
    expect(parseStatusResult({ ...valid, status: { ...valid.status, credential: { state: 'logged-in', configured: true, expiresAt: 'access-token' } } })).toBeUndefined()
    expect(parseStatusResult({ ...valid, status: { ...valid.status, revoke: { state: 'failed', errorCode: 'invalid-grant' } } })).toBeUndefined()
  })

  it('keeps the browser face typed and forwards only fixed operations', async () => {
    const status = createStatusView(false, { phase: 'idle', configured: false, projectAvailable: false })
    const rpc = {
      call: vi.fn()
        .mockResolvedValueOnce({ ok: true, value: { status } })
        .mockResolvedValueOnce({ ok: true, value: { acknowledged: true } })
        .mockResolvedValueOnce({ ok: true, value: loginFixture() })
        .mockResolvedValueOnce({ ok: true, value: { phase: 'cancelled', errorCode: 'cancelled' } })
        .mockResolvedValueOnce({ ok: true, value: { state: 'logged-out' } })
        .mockResolvedValueOnce({ ok: true, value: { state: 'revoked' } })
        .mockResolvedValueOnce({ ok: true, value: { completed: false, phase: 'failed', errorCode: 'oauth-error' } }),
    }
    const client = createAntigravityAuthRpcClient(rpc)

    await client.status()
    await client.acknowledgeRisk()
    await client.login()
    await client.cancelLogin()
    await client.logout()
    await client.revoke()
    await client.completeCallback('http://localhost:51121/oauth-callback?state=state&code=code')

    expect(rpc.call.mock.calls.map(call => call.slice(0, 3))).toEqual([
      ['/antigravity-auth', 'status', {}],
      ['/antigravity-auth', 'acknowledge-risk', { acknowledge: true }],
      ['/antigravity-auth', 'login', {}],
      ['/antigravity-auth', 'cancel', {}],
      ['/antigravity-auth', 'logout', {}],
      ['/antigravity-auth', 'revoke', { confirmed: true }],
      ['/antigravity-auth', 'complete-callback', { callbackUrl: 'http://localhost:51121/oauth-callback?state=state&code=code' }],
    ])
  })
})
