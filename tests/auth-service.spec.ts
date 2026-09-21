import { describe, expect, it, vi } from 'vitest'
import { createMemoryAuthStore } from '../src/auth-store.ts'
import { createAntigravityAuthService } from '../src/auth-service.ts'
import { createMemoryAccountStore, type AntigravityAccountStore } from '../src/account-store.ts'
import type { PrivateTransport, PrivateTransportRequest } from '../src/private-transport.ts'
import type { LoopbackCallbackRequest } from '../src/oauth-flow.ts'
import { createMemoryCapabilityGates, type CapabilityGateRegistry } from '../src/capability-gates.ts'
import { CredentialOperationError } from '../src/credential-coordinator.ts'


function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve: () => resolve() }
}

function delaySync(inner: AntigravityAccountStore, gate: Promise<void>): AntigravityAccountStore {
  return {
    path: inner.path,
    read: () => inner.read(),
    saveAccount: draft => inner.saveAccount(draft),
    setActive: query => inner.setActive(query),
    removeAccount: query => inner.removeAccount(query),
    list: () => inner.list(),
    syncRefreshToken: async update => {
      await gate
      return inner.syncRefreshToken(update)
    },
  }
}

function projectTransport(payload: unknown): PrivateTransport {
  return { request: vi.fn(async () => new Response(JSON.stringify(payload))) }
}

async function passAllLlmFamilies(gates: CapabilityGateRegistry, subject: string): Promise<void> {
  await gates.recordLlmFamily(subject, 'gemini', 'passed')
  await gates.recordLlmFamily(subject, 'claude', 'passed')
  await gates.recordLlmFamily(subject, 'gpt-oss', 'passed')
}

function listenerFixture() {
  const listeners: Array<{ close: ReturnType<typeof vi.fn> }> = []
  const handlers: Array<(request: LoopbackCallbackRequest) => Promise<unknown>> = []
  return {
    listeners,
    handlers,
    listenerFactory: {
      listen: vi.fn(async (handler: (request: LoopbackCallbackRequest) => Promise<unknown>) => {
        const listener = { close: vi.fn(async () => {}) }
        listeners.push(listener)
        handlers.push(handler)
        return listener
      }),
    },
  }
}

describe('Antigravity auth service', () => {
  it('requires risk acknowledgement, persists only after project validation, and keeps access tokens in Host memory', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 2_000 })
    const gates = createMemoryCapabilityGates()
    await gates.recordGate0('stale-lineage', 'passed')
    await passAllLlmFamilies(gates, 'stale-lineage')
    const fixture = listenerFixture()
    const service = createAntigravityAuthService({
      store,
      gates,
      projectOptions: {
        transport: projectTransport({ cloudaicompanionProject: { id: 'project-secret' } }),
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
      capabilities: [
        { id: 'auth-llm', state: 'poc-pending', reasonCode: 'gate-not-run' },
        { id: 'search', state: 'poc-pending', reasonCode: 'gate-not-run' },
        { id: 'image', state: 'poc-pending', reasonCode: 'gate-not-run' },
        { id: 'video', state: 'poc-pending', reasonCode: 'gate-not-run' },
      ],
    })
    await service.dispose()
  })

  it('auto-activates capability gates upon successful login when autoActivateGates is enabled', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 2_000 })
    const gates = createMemoryCapabilityGates()
    const fixture = listenerFixture()
    const service = createAntigravityAuthService({
      store,
      gates,
      autoActivateGates: true,
      projectOptions: {
        transport: projectTransport({ cloudaicompanionProject: { id: 'project-secret' } }),
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

    await service.acknowledgeRisk()
    const started = await service.startLogin()
    const state = new URL(started.authorizationUrl).searchParams.get('state')
    await expect(service.completeCallback(`http://localhost:51121/oauth-callback?state=${state}&code=code`)).resolves.toMatchObject({
      completed: true,
      phase: 'success',
    })

    expect(await service.status()).toMatchObject({
      capabilities: [
        { id: 'auth-llm', state: 'available', reasonCode: 'capability-ready' },
        { id: 'search', state: 'available', reasonCode: 'capability-ready' },
        { id: 'image', state: 'available', reasonCode: 'capability-ready' },
        { id: 'video', state: 'available', reasonCode: 'capability-ready' },
      ],
    })
    await service.dispose()
  })

  it('notifies status listeners when the loopback callback commits a credential', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 2_000 })
    const gates = createMemoryCapabilityGates()
    const fixture = listenerFixture()
    const service = createAntigravityAuthService({
      store,
      gates,
      autoActivateGates: true,
      projectOptions: {
        transport: projectTransport({ cloudaicompanionProject: { id: 'project-secret' } }),
      },
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

    const observed = vi.fn()
    const unwatch = service.watchStatus(observed)
    await service.acknowledgeRisk()
    const started = await service.startLogin()
    const state = new URL(started.authorizationUrl).searchParams.get('state')
    // The browser redirect is served by the loopback listener, which never
    // passes through the public completeCallback wrapper.
    observed.mockClear()
    const handler = fixture.handlers[0]
    if (handler === undefined) throw new Error('the loopback listener was not created')
    await handler({ method: 'GET', host: 'localhost:51121', url: `/oauth-callback?state=${state}&code=code` })

    await vi.waitFor(() => { expect(observed).toHaveBeenCalled() })
    unwatch()
    await service.dispose()
  })

  it('uses the default read-only project probe before replacing a credential', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 4_000 })
    const fixture = listenerFixture()
    const request = vi.fn(async (input: PrivateTransportRequest) => {
      expect(String(input.body)).not.toContain('onboardUser')
      return new Response(JSON.stringify({ cloudaicompanionProject: { id: 'discovered-project' } }))
    })
    const service = createAntigravityAuthService({
      store,
      projectOptions: { transport: { request } },
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
    expect(request).toHaveBeenCalledOnce()
    await expect(store.read()).resolves.toMatchObject({ projectId: 'discovered-project', refreshToken: 'refresh-secret' })
    await service.dispose()
  })

  it('projects persisted live gate evidence without inferring unrun capabilities', async () => {
    const store = createMemoryAuthStore()
    const record = await store.commit({ refreshToken: 'refresh', projectId: 'project-id' })
    const subject = record.lineage!
    const gates = createMemoryCapabilityGates()
    await gates.recordGate0(subject, 'passed')
    await passAllLlmFamilies(gates, subject)
    await gates.recordCapability(subject, 'search', 'rate-limited')
    const service = createAntigravityAuthService({ store, gates })

    await expect(service.status()).resolves.toMatchObject({
      capabilities: [
        { id: 'auth-llm', state: 'available', reasonCode: 'capability-ready' },
        { id: 'search', state: 'disabled', reasonCode: 'rate-limited' },
        { id: 'image', state: 'poc-pending', reasonCode: 'gate-not-run' },
        { id: 'video', state: 'poc-pending', reasonCode: 'gate-not-run' },
      ],
    })
    await service.dispose()
  })

  it('keeps LLM family compatibility independent until all three family gates pass', async () => {
    const store = createMemoryAuthStore()
    await store.commit({ refreshToken: 'refresh', projectId: 'project-id' })
    const gates = createMemoryCapabilityGates()
    const service = createAntigravityAuthService({ store, gates })

    await service.recordGate0('passed')
    await service.recordLlmFamilyGate('gemini', 'passed')
    expect(await service.capabilityAvailable('auth-llm')).toBe(false)
    await expect(service.recordCapabilityGate('auth-llm', 'passed')).rejects.toMatchObject({ code: 'internal' })
    await service.recordLlmFamilyGate('claude', 'passed')
    expect(await service.capabilityAvailable('auth-llm')).toBe(false)
    await service.recordLlmFamilyGate('gpt-oss', 'passed')
    expect(await service.capabilityAvailable('auth-llm')).toBe(true)
    const aggregateWrite = vi.spyOn(gates, 'recordCapability').mockRejectedValue(new Error('aggregate writes are forbidden'))
    await expect(service.recordLlmFamilyGate('claude', 'protocol-drift')).resolves.toBeUndefined()
    expect(aggregateWrite).not.toHaveBeenCalled()
    expect(await service.capabilityAvailable('auth-llm')).toBe(false)
    await service.dispose()
  })

  it('preserves existing gate evidence when a replacement login is superseded', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 3_000 })
    const oldRecord = await store.commit({ refreshToken: 'old-refresh', projectId: 'old-project' })
    const subject = oldRecord.lineage!
    const gates = createMemoryCapabilityGates()
    await gates.recordGate0(subject, 'passed')
    await passAllLlmFamilies(gates, subject)
    const fixture = listenerFixture()
    const service = createAntigravityAuthService({
      store,
      gates,
      projectOptions: { transport: projectTransport({ cloudaicompanionProject: { id: 'new-project' } }) },
      flowOptions: {
        listenerFactory: fixture.listenerFactory,
        exchangeCode: vi.fn(async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 9_000 })),
      },
    })
    await service.acknowledgeRisk()
    const started = await service.startLogin()
    const state = new URL(started.authorizationUrl).searchParams.get('state')
    vi.spyOn(store, 'compareAndCommit').mockResolvedValueOnce(undefined)

    await expect(service.completeCallback(`http://localhost:51121/oauth-callback?state=${state}&code=code`)).resolves.toMatchObject({
      completed: false,
      phase: 'failed',
      errorCode: 'credential-conflict',
    })
    const status = await service.status()
    expect(status.capabilities.find(capability => capability.id === 'auth-llm')).toMatchObject({
      state: 'available',
      reasonCode: 'capability-ready',
    })
    await service.dispose()
  })

  it('fences prior evidence atomically when physical gate cleanup fails', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 3_000 })
    const oldRecord = await store.commit({ refreshToken: 'old-refresh', projectId: 'old-project' })
    const subject = oldRecord.lineage!
    const gates = createMemoryCapabilityGates()
    await gates.recordGate0(subject, 'passed')
    await passAllLlmFamilies(gates, subject)
    vi.spyOn(gates, 'clear').mockRejectedValueOnce(new Error('gate storage unavailable'))
    const fixture = listenerFixture()
    const service = createAntigravityAuthService({
      store,
      gates,
      projectOptions: { transport: projectTransport({ cloudaicompanionProject: { id: 'new-project' } }) },
      flowOptions: {
        listenerFactory: fixture.listenerFactory,
        exchangeCode: vi.fn(async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 9_000 })),
      },
    })
    await service.acknowledgeRisk()
    const started = await service.startLogin()
    const state = new URL(started.authorizationUrl).searchParams.get('state')

    await expect(service.completeCallback(`http://localhost:51121/oauth-callback?state=${state}&code=code`)).resolves.toMatchObject({
      completed: true,
      phase: 'success',
    })
    await expect(store.read()).resolves.toMatchObject({
      refreshToken: 'new-refresh',
      projectId: 'new-project',
    })
    await expect(gates.read()).resolves.toMatchObject({ subject, gate0: { outcome: 'passed' } })
    expect((await service.status()).capabilities.find(capability => capability.id === 'auth-llm')).toMatchObject({
      state: 'poc-pending',
      reasonCode: 'gate-not-run',
    })
    await service.dispose()
  })

  it('preserves the existing single-account record when project validation fails', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 3_000 })
    await store.commit({ refreshToken: 'old-refresh', projectId: 'old-project', email: 'o***@example.com' })
    const fixture = listenerFixture()
    const service = createAntigravityAuthService({
      store,
      projectOptions: {
        transport: projectTransport({ currentTier: { id: 'free' } }),
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

  it('supports listing multiple accounts in status, switching active account, and removing account', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 4_000 })
    const service = createAntigravityAuthService({ store })
    await service.accountStore.saveAccount({ email: 'user1@example.com', projectId: 'project-1', refreshToken: 'refresh-1' })
    await service.accountStore.saveAccount({ email: 'user2@example.com', projectId: 'project-2', refreshToken: 'refresh-2' })
    await service.switchAccount('user2@example.com')

    const status = await service.status()
    expect(status.accounts).toHaveLength(2)
    const user2Id = (await service.accountStore.read()).accounts.find(a => a.email === 'user2@example.com')?.id
    expect(status.activeAccountId).toBe(user2Id)

    // Switch account to user1
    const switchRes = await service.switchAccount('user1@example.com')
    expect(switchRes.ok).toBe(true)
    const switchedStatus = await service.status()
    const user1Id = (await service.accountStore.read()).accounts.find(a => a.email === 'user1@example.com')?.id
    expect(switchedStatus.activeAccountId).toBe(user1Id)

    // Remove user1
    const removeRes = await service.removeAccount('user1@example.com')
    expect(removeRes.ok).toBe(true)
    const remainingStatus = await service.status()
    expect(remainingStatus.accounts).toHaveLength(1)

    await service.dispose()
  })

  it('backfills the active account email through the injected fetcher once per process', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 4_000 })
    await store.commit({ refreshToken: 'rt-1', projectId: 'p-1' })
    const fetchEmail = vi.fn(async () => 'carol@example.com')
    const service = createAntigravityAuthService({
      store,
      fetchEmail,
      credentialOptions: {
        refreshToken: vi.fn(async () => ({ accessToken: 'live-access', expiresAt: 10_000 })),
      },
    })

    const first = await service.listAccounts()
    expect(fetchEmail).toHaveBeenCalledWith('live-access')
    expect(first.accounts[0]?.email).toBe('carol@example.com')
    expect(first.accounts[0]?.maskedEmail).toBe('c***@example.com')
    await expect(store.read()).resolves.toMatchObject({ email: 'c***@example.com' })

    // The once-per-process fence prevents a second probe.
    await service.listAccounts()
    expect(fetchEmail).toHaveBeenCalledTimes(1)
    await service.dispose()
  })

  it('leaves the email unset when the injected fetcher cannot answer', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 4_000 })
    await store.commit({ refreshToken: 'rt-1', projectId: 'p-1' })
    const fetchEmail = vi.fn(async () => undefined)
    const service = createAntigravityAuthService({
      store,
      fetchEmail,
      credentialOptions: {
        refreshToken: vi.fn(async () => ({ accessToken: 'live-access', expiresAt: 10_000 })),
      },
    })

    const listed = await service.listAccounts()
    expect(fetchEmail).toHaveBeenCalledWith('live-access')
    expect(listed.accounts[0]?.email).toBeUndefined()
    await expect(store.read()).resolves.not.toHaveProperty('email')
    await service.dispose()
  })

  it('syncs rotated refresh token to account cache and preserves it across switches', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 4_000 })
    await store.commit({ refreshToken: 'token-A1', projectId: 'p-1', email: 'alice@example.com' })
    const refreshAccessToken = vi.fn(async () => ({
      accessToken: 'access-A2',
      refreshToken: 'token-A2',
      expiresAt: 10_000,
    }))
    const service = createAntigravityAuthService({
      store,
      credentialOptions: {
        now: () => 4_000,
        refreshToken: refreshAccessToken,
      },
    })

    // Seed account B into accountStore
    await service.accountStore.saveAccount({
      id: 'acc_2',
      email: 'bob@example.com',
      projectId: 'p-2',
      refreshToken: 'token-B',
    })

    // Trigger refresh on account A, rotating its token to token-A2
    const cred = await service.credential(undefined, { forceRefresh: true })
    expect(cred?.refreshToken).toBe('token-A2')
    expect((await store.read())?.refreshToken).toBe('token-A2')

    // Verify account store also synced token-A2
    const accounts = (await service.listAccounts()).accounts
    const accA = accounts.find(a => a.email === 'alice@example.com')
    expect(accA?.refreshToken).toBe('token-A2')

    // Switch to account B
    await service.switchAccount('bob@example.com')
    expect((await store.read())?.refreshToken).toBe('token-B')

    // Switch back to account A
    await service.switchAccount('alice@example.com')
    // Must write token-A2 back to store, not the obsolete token-A1!
    expect((await store.read())?.refreshToken).toBe('token-A2')

    await service.dispose()
  })

  it('cleans up cached account credentials on logout', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 4_000 })
    await store.commit({ refreshToken: 'token-A1', projectId: 'p-1', email: 'alice@example.com' })
    const service = createAntigravityAuthService({ store })

    expect((await service.listAccounts()).accounts).toHaveLength(1)

    // Log out
    await service.logout()

    // Both authStore and accountStore must be cleared of account A
    expect(await store.read()).toBeUndefined()
    expect((await service.listAccounts()).accounts).toHaveLength(0)

    // Cannot switch back to account A without re-login
    const switchRes = await service.switchAccount('alice@example.com')
    expect(switchRes.ok).toBe(false)

    await service.dispose()
  })

  it('resets error state when switching from an invalid account to a valid account', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 4_000 })
    await store.commit({ refreshToken: 'invalid-token-A', projectId: 'p-1', email: 'alice@example.com' })

    const refreshAccessToken = vi.fn(async ({ refreshToken }: { refreshToken: string }) => {
      if (refreshToken === 'invalid-token-A') {
        throw new CredentialOperationError('invalid-grant')
      }
      return { accessToken: 'valid-access-B', expiresAt: 10_000 }
    })

    const service = createAntigravityAuthService({
      store,
      credentialOptions: {
        now: () => 4_000,
        refreshToken: refreshAccessToken,
      },
    })

    // Add account B
    await service.accountStore.saveAccount({
      id: 'acc_2',
      email: 'bob@example.com',
      projectId: 'p-2',
      refreshToken: 'valid-token-B',
    })

    // Account A fails and enters re-login-required
    const credA = await service.credential(undefined, { forceRefresh: true })
    expect(credA).toBeUndefined()
    const statusA = await service.status()
    expect(statusA.credential?.state).toBe('re-login-required')

    // Switch to account B
    await service.switchAccount('bob@example.com')

    // Coordinator error state must be reset so B can successfully fetch credentials!
    const credB = await service.credential()
    expect(credB).toBeDefined()
    expect(credB?.accessToken).toBe('valid-access-B')
    expect(credB?.projectId).toBe('p-2')

    const statusB = await service.status()
    expect(statusB.credential?.state).toBe('logged-in')

    await service.dispose()
  })

  it('does not write a late token rotation onto the account switched in during cache sync', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 4_000 })
    await store.commit({ refreshToken: 'token-A1', projectId: 'p-1', email: 'alice@example.com' })
    const gate = deferred()
    let syncEntered = false
    const inner = delaySync(createMemoryAccountStore(store), gate.promise)
    const accountStore: AntigravityAccountStore = {
      ...inner,
      syncRefreshToken: async update => {
        syncEntered = true
        return inner.syncRefreshToken(update)
      },
    }
    await accountStore.saveAccount({ email: 'alice@example.com', projectId: 'p-1', refreshToken: 'token-A1' })
    await accountStore.saveAccount({ email: 'bob@example.com', projectId: 'p-2', refreshToken: 'token-B' })
    await accountStore.setActive('alice@example.com')

    const refreshAccessToken = vi.fn(async () => ({
      accessToken: 'access-A2',
      refreshToken: 'token-A2',
      expiresAt: 10_000,
    }))
    const service = createAntigravityAuthService({
      store,
      accountStore,
      credentialOptions: {
        now: () => 4_000,
        refreshToken: refreshAccessToken,
      },
    })

    const pending = service.credential(undefined, { forceRefresh: true })
    await vi.waitFor(() => expect(syncEntered).toBe(true))
    await service.switchAccount('bob@example.com')
    gate.resolve()
    await pending

    expect((await store.read())?.refreshToken).toBe('token-B')
    expect((await store.read())?.projectId).toBe('p-2')
    const listed = await accountStore.list()
    expect(listed.accounts.find(a => a.email === 'alice@example.com')?.refreshToken).toBe('token-A2')
    expect(listed.accounts.find(a => a.email === 'bob@example.com')?.refreshToken).toBe('token-B')
    expect(listed.accounts.find(a => a.email === 'bob@example.com')?.projectId).toBe('p-2')
    await service.dispose()
  })

  it('does not delete the new active account when a superseded revoke finishes', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 4_000 })
    await store.commit({ refreshToken: 'token-A', projectId: 'p-1', email: 'alice@example.com' })
    const gate = deferred()
    const revokeGrant = vi.fn(async () => { await gate.promise })
    const service = createAntigravityAuthService({
      store,
      credentialOptions: {
        now: () => 4_000,
        revokeGrant,
      },
    })
    await service.accountStore.saveAccount({ email: 'bob@example.com', projectId: 'p-2', refreshToken: 'token-B' })

    const pending = service.revoke(true)
    await vi.waitFor(() => expect(revokeGrant).toHaveBeenCalledTimes(1))
    await service.switchAccount('bob@example.com')
    gate.resolve()
    await expect(pending).resolves.toEqual({ state: 'superseded' })

    expect((await store.read())?.refreshToken).toBe('token-B')
    const listed = await service.listAccounts()
    expect(listed.accounts.find(a => a.email === 'bob@example.com')).toBeDefined()
    expect(listed.accounts.find(a => a.email === 'alice@example.com')).toBeDefined()
    expect(listed.activeId).toBe(listed.accounts.find(a => a.email === 'bob@example.com')?.id)
    await service.dispose()
  })

  it('discards an email probe that finishes after the account is no longer active', async () => {
    const store = createMemoryAuthStore(undefined, { now: () => 4_000 })
    await store.commit({ refreshToken: 'token-A', projectId: 'p-1' })
    const gate = deferred()
    let fetchStarted = false
    const fetchEmail = vi.fn(async () => {
      fetchStarted = true
      await gate.promise
      return 'alice@example.com'
    })
    const service = createAntigravityAuthService({
      store,
      fetchEmail,
      credentialOptions: {
        now: () => 4_000,
        refreshToken: async () => ({ accessToken: 'access-A', expiresAt: 10_000 }),
      },
    })
    await service.accountStore.saveAccount({ projectId: 'p-2', refreshToken: 'token-B' })
    const aliceId = (await service.accountStore.read()).accounts.find(a => a.refreshToken === 'token-A')!.id
    await service.accountStore.setActive(aliceId)

    const pending = service.listAccounts()
    await vi.waitFor(() => expect(fetchStarted).toBe(true))
    const bobId = (await service.accountStore.read()).accounts.find(a => a.refreshToken === 'token-B')!.id
    await service.switchAccount(bobId)
    gate.resolve()
    await pending

    const listed = await service.accountStore.list()
    expect(listed.accounts.find(a => a.refreshToken === 'token-B')?.email).toBeUndefined()
    expect(listed.accounts.find(a => a.refreshToken === 'token-A')?.email).toBeUndefined()
    expect((await store.read())?.email).toBeUndefined()
    await service.dispose()
  })
})
