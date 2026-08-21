// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AntigravityAuthSettings } from '../src/client/AntigravityAuthSettings.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { AntigravityAuthRpcClient } from '../src/rpc-contract.ts'
import { createStatusView } from '../src/status.ts'
import type { LoginStatusView } from '../src/status.ts'
import type { CredentialStatusView, RevokeStatusView } from '../src/credential-coordinator.ts'

function rpcFixture(
  login: LoginStatusView = { phase: 'idle', configured: false, projectAvailable: false },
  riskAcknowledged = false,
  credential?: CredentialStatusView,
  revoke?: RevokeStatusView,
): AntigravityAuthRpcClient {
  const status = createStatusView(riskAcknowledged, login, credential, revoke)
  return {
    status: vi.fn().mockResolvedValue({ ok: true, value: { status } }),
    acknowledgeRisk: vi.fn().mockResolvedValue({ ok: true, value: { acknowledged: true } }),
    login: vi.fn().mockResolvedValue({ ok: true, value: {
      started: true,
      phase: 'pending',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=abcdefghijklmnopqrstuvwxyz123456',
      expiresAt: '2026-08-21T00:00:00.000Z',
    } }),
    cancelLogin: vi.fn().mockResolvedValue({ ok: true, value: { phase: 'cancelled', errorCode: 'cancelled' } }),
    logout: vi.fn().mockResolvedValue({ ok: true, value: { state: 'logged-out' } }),
    revoke: vi.fn().mockResolvedValue({ ok: true, value: { state: 'revoked' } }),
    completeCallback: vi.fn().mockResolvedValue({ ok: true, value: { completed: false, phase: 'failed', errorCode: 'no-pending-flow' } }),
  }
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('Antigravity bootstrap settings', () => {
  it('requires risk acknowledgement before login and exposes gate status without secret controls', async () => {
    const rpc = rpcFixture()
    const unsubscribe = vi.fn()
    const { unmount } = render(
      <AntigravityAuthSettings rpc={rpc} t={key => en[key]} subscribe={() => unsubscribe} />,
    )

    expect(await screen.findByRole('heading', { name: 'Unofficial / Experimental' })).toBeTruthy()
    expect(screen.getByText(/Google does not support third-party/i)).toBeTruthy()
    expect(screen.getByText(/Single-account only/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.login })).toHaveProperty('disabled', true)
    expect(screen.getAllByText('POC pending')).toHaveLength(4)
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.queryByLabelText(/token|client secret|endpoint/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /add|switch|rotate/i })).toBeNull()

    const acknowledgement = screen.getByRole('checkbox', { name: en.riskAcknowledgement })
    fireEvent.click(acknowledgement)
    await waitFor(() => expect(rpc.acknowledgeRisk).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: en.login })).toHaveProperty('disabled', false)
    expect(screen.getByText(en.loginReady)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.login }))
    await waitFor(() => expect(rpc.login).toHaveBeenCalledOnce())
    expect(screen.getByRole('link', { name: en.openAuthorization }).getAttribute('target')).toBe('_blank')
    expect(screen.getByRole('button', { name: en.cancelLogin })).toBeTruthy()

    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('renders Host-only logout and separately confirmed revoke controls', async () => {
    const rpc = rpcFixture(
      { phase: 'success', configured: true, projectAvailable: true, maskedEmail: 'a***@example.com' },
      true,
      { state: 'logged-in', configured: true },
      { state: 'idle' },
    )
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(true)
    render(<AntigravityAuthSettings rpc={rpc} t={key => en[key]} subscribe={() => () => {}} />)

    expect(await screen.findByRole('button', { name: en.logout })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.logout }))
    await waitFor(() => expect(rpc.logout).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: en.revoke }))
    await waitFor(() => expect(rpc.revoke).toHaveBeenCalledOnce())
    expect(confirm).toHaveBeenCalledWith(en.revokeConfirm)
    confirm.mockRestore()
  })

  it('renders the same status shell with Chinese copy', async () => {
    const rpc = rpcFixture()
    render(<AntigravityAuthSettings rpc={rpc} t={key => zh[key]} subscribe={() => () => {}} />)

    expect(await screen.findByRole('heading', { name: '非官方 / 实验性' })).toBeTruthy()
    expect(screen.getByText(/Google 不支持第三方/i)).toBeTruthy()
    expect(screen.getAllByText('POC 待验证')).toHaveLength(4)
  })

  it('renders safe pending, success, cancelled, expired, port-conflict, and failure states', async () => {
    const cases = [
      ['pending', { phase: 'pending', configured: false, projectAvailable: false, authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?state=${'a'.repeat(43)}`, expiresAt: '2026-08-21T00:00:00.000Z' }, en.loginPending],
      ['success', { phase: 'success', configured: true, projectAvailable: true, maskedEmail: 'a***@example.com' }, en.loginSuccess],
      ['cancelled', { phase: 'cancelled', configured: false, projectAvailable: false, errorCode: 'cancelled' }, en.loginCancelled],
      ['expired', { phase: 'expired', configured: false, projectAvailable: false, errorCode: 'expired' }, en.loginExpired],
      ['port-conflict', { phase: 'port-conflict', configured: false, projectAvailable: false, errorCode: 'port-conflict' }, en.loginPortConflict],
      ['failed', { phase: 'failed', configured: false, projectAvailable: false, errorCode: 'project-unavailable' }, en.loginFailed],
    ] as const
    for (const [_name, login, copy] of cases) {
      const { unmount } = render(<AntigravityAuthSettings rpc={rpcFixture(login, true)} t={key => en[key]} subscribe={() => () => {}} />)
      expect((await screen.findAllByText(copy)).length).toBeGreaterThan(0)
      if (_name === 'success') {
        expect(screen.getByText('a***@example.com')).toBeTruthy()
        expect(screen.getByText(en.projectAvailable)).toBeTruthy()
      }
      unmount()
      document.body.innerHTML = ''
    }
  })

  it.each([
    ['project-authentication-failed', en.projectAuthenticationFailed],
    ['project-forbidden', en.projectForbidden],
    ['project-rate-limited', en.projectRateLimited],
    ['project-offline', en.projectOffline],
    ['project-malformed', en.projectMalformed],
    ['project-protocol-drift', en.projectProtocolDrift],
  ] as const)('renders a safe project discovery state for %s', async (errorCode, copy) => {
    const { unmount } = render(
      <AntigravityAuthSettings
        rpc={rpcFixture({ phase: 'failed', configured: false, projectAvailable: false, errorCode }, true)}
        t={key => en[key]}
        subscribe={() => () => {}}
      />,
    )
    expect(await screen.findByText(copy)).toBeTruthy()
    expect(screen.getAllByText(en.projectUnavailable).length).toBeGreaterThan(0)
    unmount()
    document.body.innerHTML = ''
  })

  it('polls Host status while pending so callback completion reaches the settings UI', async () => {
    vi.useFakeTimers()
    const pending: LoginStatusView = {
      phase: 'pending',
      configured: false,
      projectAvailable: false,
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?state=${'a'.repeat(43)}`,
      expiresAt: '2026-08-21T00:00:00.000Z',
    }
    const completed: LoginStatusView = { phase: 'success', configured: true, projectAvailable: true, maskedEmail: 'a***@example.com' }
    const base = rpcFixture(pending, true)
    const status = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { status: createStatusView(true, pending) } })
      .mockResolvedValueOnce({ ok: true, value: { status: createStatusView(true, completed) } })
    const rpc = { ...base, status: status as typeof base.status }
    const { unmount } = render(<AntigravityAuthSettings rpc={rpc} t={key => en[key]} subscribe={() => () => {}} />)

    await vi.waitFor(() => expect(status).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2))
    expect(screen.getAllByText(en.loginSuccess).length).toBeGreaterThan(0)
    expect(screen.getByText('a***@example.com')).toBeTruthy()
    unmount()
    vi.useRealTimers()
  })

  it('aborts an in-flight status read and unsubscribes on unmount', async () => {
    let signal: AbortSignal | undefined
    const status = vi.fn((_candidate?: AbortSignal) => {
      signal = _candidate
      return new Promise<never>(() => {})
    })
    const unsubscribe = vi.fn()
    const { unmount } = render(
      <AntigravityAuthSettings
        rpc={{ status, acknowledgeRisk: vi.fn(), login: vi.fn() } as unknown as AntigravityAuthRpcClient}
        t={key => en[key]}
        subscribe={() => unsubscribe}
      />,
    )

    await waitFor(() => expect(signal).toBeDefined())
    unmount()
    expect(signal?.aborted).toBe(true)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
