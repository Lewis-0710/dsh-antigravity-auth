import { describe, expect, it, vi } from 'vitest'
import { createMemoryAuthStore } from '../src/auth-store.ts'
import { createAntigravityAuthService } from '../src/auth-service.ts'

function listenerFixture() {
  const listeners: Array<{ close: ReturnType<typeof vi.fn> }> = []
  return {
    listeners,
    listenerFactory: {
      listen: vi.fn(async () => {
        const listener = { close: vi.fn(async () => {}) }
        listeners.push(listener)
        return listener
      }),
    },
  }
}

describe('Antigravity auth service', () => {
  it('requires risk acknowledgement, persists only after project validation, and keeps access tokens in Host memory', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 2_000 })
    const fixture = listenerFixture()
    const service = createAntigravityAuthService({
      store,
      projectOptions: {
        fetchImpl: vi.fn(async () => new Response(JSON.stringify({ cloudaicompanionProject: { id: 'project-secret' } }))),
      },
      flowOptions: {
        randomBytes: size => Uint8Array.from({ length: size }, (_, index) => index + 1),
        listenerFactory: fixture.listenerFactory,
        exchangeCode: vi.fn(async () => ({
          accessToken: 'access-secret',
          refreshToken: 'refresh-secret',
          expiresAt: 9_000,
          email: 'alice@example.com',
        })),
      },
    })

    await expect(service.startLogin()).rejects.toMatchObject({ code: 'risk-acknowledgement-required' })
    await service.acknowledgeRisk()
    const started = await service.startLogin()
    const state = new URL(started.authorizationUrl).searchParams.get('state')
    await expect(service.completeCallback(`http://localhost:51121/oauth-callback?state=${state}&code=code`)).resolves.toMatchObject({
      completed: true,
      phase: 'success',
    })

    const record = await store.read()
    expect(record).toMatchObject({ refreshToken: 'refresh-secret', projectId: 'project-secret', email: 'a***@example.com' })
    expect(JSON.stringify(record)).not.toContain('access-secret')
    expect(JSON.stringify(record)).not.toContain('alice@example.com')
    expect(JSON.stringify(await service.status())).not.toContain('project-secret')
    expect(await service.status()).toMatchObject({
      riskAcknowledged: true,
      login: { phase: 'success', configured: true, projectAvailable: true, maskedEmail: 'a***@example.com' },
    })
    await service.dispose()
  })

  it('uses the default read-only project probe before replacing a credential', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 4_000 })
    const fixture = listenerFixture()
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(String(init?.body)).not.toContain('onboardUser')
      return new Response(JSON.stringify({ cloudaicompanionProject: { id: 'discovered-project' } }))
    })
    const service = createAntigravityAuthService({
      store,
      projectOptions: { fetchImpl },
      flowOptions: {
        randomBytes: size => Uint8Array.from({ length: size }, (_, index) => index + 1),
        listenerFactory: fixture.listenerFactory,
        exchangeCode: vi.fn(async () => ({
          accessToken: 'access-secret',
          refreshToken: 'refresh-secret',
          expiresAt: 9_000,
        })),
      },
    })
    await service.acknowledgeRisk()
    const started = await service.startLogin()
    const state = new URL(started.authorizationUrl).searchParams.get('state')

    await expect(service.completeCallback(`http://localhost:51121/oauth-callback?state=${state}&code=code`)).resolves.toMatchObject({
      completed: true,
      phase: 'success',
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    await expect(store.read()).resolves.toMatchObject({ projectId: 'discovered-project', refreshToken: 'refresh-secret' })
    await service.dispose()
  })

  it('preserves the existing single-account record when project validation fails', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 3_000 })
    await store.commit({ refreshToken: 'old-refresh', projectId: 'old-project', email: 'o***@example.com' })
    const fixture = listenerFixture()
    const service = createAntigravityAuthService({
      store,
      projectOptions: {
        fetchImpl: vi.fn(async () => new Response(JSON.stringify({ currentTier: { id: 'free' } }))),
      },
      credentialOptions: {
        refreshToken: vi.fn(async () => ({ accessToken: 'old-access', expiresAt: 9_000 })),
      },
      flowOptions: {
        listenerFactory: fixture.listenerFactory,
        exchangeCode: vi.fn(async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 9_000 })),
      },
    })
    await service.acknowledgeRisk()
    const started = await service.startLogin()
    const state = new URL(started.authorizationUrl).searchParams.get('state')

    await expect(service.completeCallback(`http://localhost:51121/oauth-callback?state=${state}&code=code`)).resolves.toEqual({
      completed: false,
      phase: 'failed',
      errorCode: 'project-unavailable',
    })
    expect(await store.read()).toMatchObject({ refreshToken: 'old-refresh', projectId: 'old-project' })
    await expect(service.credential()).resolves.toMatchObject({ accessToken: 'old-access', projectId: 'old-project' })
    await expect(service.status()).resolves.toMatchObject({ login: { configured: true, projectAvailable: true } })
    await service.dispose()
  })
})
