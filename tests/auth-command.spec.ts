import { describe, expect, it, vi } from 'vitest'
import { createAntigravityAuthCommand } from '../src/auth-command.ts'
import type { LogoutResult } from '../src/credential-coordinator.ts'
import type { LoginActionResult, LoginStartResult } from '../src/login-types.ts'
import type { LoopbackRpcMode } from '../src/loopback-rpc.ts'
import type { AntigravityStatusView, RiskAcknowledgementResult } from '../src/status.ts'

const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth?state=test-state'

function idleStatus(): AntigravityStatusView {
  return {
    pluginId: 'dsh-antigravity-auth',
    phase: 'bootstrap',
    privateSelfUse: true,
    singleAccount: true,
    riskAcknowledgementRequired: true,
    riskAcknowledged: false,
    login: { phase: 'idle', configured: false, projectAvailable: false },
    capabilities: [],
  }
}

function configuredStatus(): AntigravityStatusView {
  return {
    pluginId: 'dsh-antigravity-auth',
    phase: 'bootstrap',
    privateSelfUse: true,
    singleAccount: true,
    riskAcknowledgementRequired: true,
    riskAcknowledged: true,
    login: {
      phase: 'success',
      configured: true,
      projectAvailable: true,
      maskedEmail: 'z***@gmail.com',
    },
    capabilities: [
      { id: 'auth-llm', state: 'available', reasonCode: 'capability-ready' },
      { id: 'search', state: 'disabled', reasonCode: 'gate-not-run' },
    ],
  }
}

function pendingStatus(): AntigravityStatusView {
  return {
    pluginId: 'dsh-antigravity-auth',
    phase: 'bootstrap',
    privateSelfUse: true,
    singleAccount: true,
    riskAcknowledgementRequired: true,
    riskAcknowledged: true,
    login: {
      phase: 'pending',
      configured: false,
      projectAvailable: false,
      authorizationUrl: AUTHORIZATION_URL,
      expiresAt: '2026-09-07T09:00:00.000Z',
    },
    capabilities: [],
  }
}

function emptyService() {
  return {
    acknowledgeRisk: vi.fn(),
    cancelLogin: vi.fn(),
    logout: vi.fn(),
    startLogin: vi.fn(),
    status: vi.fn(),
  }
}

function makeCommand(service: ReturnType<typeof emptyService>, mode: LoopbackRpcMode = 'enabled') {
  return createAntigravityAuthCommand(service, () => mode)
}

describe('Antigravity auth command', () => {
  it('reports value-free login status by default', async () => {
    const service = {
      ...emptyService(),
      status: vi.fn(async (): Promise<AntigravityStatusView> => idleStatus()),
    }
    const command = makeCommand(service)

    await expect(command.handler({ rawInput: '' } as never)).resolves.toEqual({
      kind: 'success',
      text: 'Antigravity auth: not configured; no project',
    })
    expect(service.startLogin).not.toHaveBeenCalled()
  })

  it('reports a configured account with available capabilities', async () => {
    const service = {
      ...emptyService(),
      status: vi.fn(async (): Promise<AntigravityStatusView> => configuredStatus()),
    }
    const command = makeCommand(service)

    await expect(command.handler({ rawInput: 'status' } as never)).resolves.toEqual({
      kind: 'success',
      text: 'Antigravity auth: configured; project available; z***@gmail.com; available: auth-llm',
    })
  })

  it('reports an in-progress authorization phase', async () => {
    const service = {
      ...emptyService(),
      status: vi.fn(async (): Promise<AntigravityStatusView> => pendingStatus()),
    }
    const command = makeCommand(service)

    await expect(command.handler({ rawInput: '' } as never)).resolves.toEqual({
      kind: 'success',
      text: 'Antigravity auth: not configured; no project; authorization pending',
    })
  })

  it('starts the browser authorization flow after acknowledging risk without persisting the authorization URL', async () => {
    const service = {
      ...emptyService(),
      acknowledgeRisk: vi.fn(async (): Promise<RiskAcknowledgementResult> => ({ acknowledged: true })),
      startLogin: vi.fn(async (): Promise<LoginStartResult> => ({
        started: true,
        phase: 'pending',
        authorizationUrl: AUTHORIZATION_URL,
        expiresAt: '2026-09-07T09:00:00.000Z',
      })),
      status: vi.fn(async (): Promise<AntigravityStatusView> => idleStatus()),
    }
    const command = makeCommand(service)

    const result = await command.handler({ rawInput: ' login ' } as never)
    expect(result).toEqual({
      kind: 'success',
      text: 'Antigravity authorization started (unofficial Antigravity channel, personal use); complete Google sign-in, then run /antigravity-auth status.',
    })
    // The OAuth authorization URL (state handle + PKCE challenge) must not be
    // persisted into the session's command/done event via the result text.
    if (result.kind === 'success') {
      expect(result.text).not.toContain(AUTHORIZATION_URL)
      expect(result.text).not.toContain('state=')
      expect(result.text).not.toContain('code_challenge')
    }
    expect(service.acknowledgeRisk).toHaveBeenCalledTimes(1)
    expect(service.startLogin).toHaveBeenCalledTimes(1)
  })

  it('refuses to start login while an authorization is already pending', async () => {
    const service = {
      ...emptyService(),
      status: vi.fn(async (): Promise<AntigravityStatusView> => pendingStatus()),
    }
    const command = makeCommand(service)

    await expect(command.handler({ rawInput: 'login' } as never)).resolves.toEqual({
      kind: 'error',
      text: 'an Antigravity authorization is already pending; finish it in the browser or run /antigravity-auth cancel',
    })
    expect(service.startLogin).not.toHaveBeenCalled()
    expect(service.acknowledgeRisk).not.toHaveBeenCalled()
  })

  it('cancels a pending authorization', async () => {
    const service = {
      ...emptyService(),
      cancelLogin: vi.fn(async (): Promise<LoginActionResult> => ({ phase: 'cancelled' })),
    }
    const command = makeCommand(service)

    await expect(command.handler({ rawInput: 'cancel' } as never)).resolves.toEqual({
      kind: 'success',
      text: 'Antigravity authorization cancelled.',
    })
    expect(service.cancelLogin).toHaveBeenCalledTimes(1)
  })

  it('logs out of the shared account', async () => {
    const service = {
      ...emptyService(),
      logout: vi.fn(async (): Promise<LogoutResult> => ({ state: 'logged-out' })),
    }
    const command = makeCommand(service)

    await expect(command.handler({ rawInput: 'logout' } as never)).resolves.toEqual({
      kind: 'success',
      text: 'Antigravity logged out.',
    })
    expect(service.logout).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown operations without touching the account', async () => {
    const service = emptyService()
    const command = makeCommand(service)

    await expect(command.handler({ rawInput: 'device' } as never)).resolves.toEqual({
      kind: 'error',
      text: 'unknown operation "device" (available: status, login, cancel, logout)',
    })
    expect(service.acknowledgeRisk).not.toHaveBeenCalled()
    expect(service.startLogin).not.toHaveBeenCalled()
    expect(service.cancelLogin).not.toHaveBeenCalled()
    expect(service.logout).not.toHaveBeenCalled()
  })

  it('surfaces service failures as command errors', async () => {
    const service = {
      ...emptyService(),
      status: vi.fn(async (): Promise<AntigravityStatusView> => { throw new Error('auth store is locked') }),
    }
    const command = makeCommand(service)

    await expect(command.handler({ rawInput: 'status' } as never)).resolves.toEqual({
      kind: 'error',
      text: 'reading Antigravity auth status failed: auth store is locked',
    })
  })

  it.each(['', 'status', 'login', 'cancel', 'logout'])(
    'denies %s off-loopback without reaching the auth service',
    async (rawInput) => {
      const service = emptyService()
      const command = makeCommand(service, 'blocked')

      await expect(command.handler({ rawInput } as never)).resolves.toEqual({
        kind: 'error',
        text: 'Antigravity account controls require a loopback-bound DSH Host',
      })
      expect(service.status).not.toHaveBeenCalled()
      expect(service.acknowledgeRisk).not.toHaveBeenCalled()
      expect(service.startLogin).not.toHaveBeenCalled()
      expect(service.cancelLogin).not.toHaveBeenCalled()
      expect(service.logout).not.toHaveBeenCalled()
    },
  )
})
