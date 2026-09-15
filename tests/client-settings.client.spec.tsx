// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AntigravityAuthSettings } from '../src/client/AntigravityAuthSettings.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { AntigravityAuthRpcClient } from '../src/rpc-contract.ts'
import type { AntigravitySearchSettings } from '../src/search.ts'
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
    models: vi.fn().mockResolvedValue({ ok: true, value: {
      state: 'snapshot',
      models: [{ id: 'antigravity-gemini-3.7-flash', name: 'Gemini 3.7 Flash', state: 'snapshot' }],
    } }),
    usage: vi.fn().mockResolvedValue({ ok: true, value: { state: 'unknown' } }),
  }
}

class ReceiverBoundSettingsScope<T> implements SettingsScope<T> {
  private readonly listeners = new Set<() => void>()
  private readonly snapshot: SettingsScopeSnapshot<T>

  constructor(value: T) {
    this.snapshot = {
      status: 'ready',
      value,
      base: value,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host',
    }
  }

  getSnapshot(): SettingsScopeSnapshot<T> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async mutate(): Promise<void> {}
  async set(): Promise<void> {}
  async unset(): Promise<void> {}
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('Antigravity bootstrap settings', () => {
  it('renders settings shell without secret controls and starts login directly', async () => {
    const rpc = rpcFixture()
    const unsubscribe = vi.fn()
    const { unmount } = render(
      <AntigravityAuthSettings rpc={rpc} t={key => en[key]} subscribe={() => unsubscribe} />,
    )

    expect(await screen.findByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.queryByLabelText(/token|client secret|endpoint/i)).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: en.login })).toHaveProperty('disabled', false)

    fireEvent.click(screen.getByRole('button', { name: en.login }))
    await waitFor(() => expect(rpc.login).toHaveBeenCalledOnce())
    expect(screen.getByRole('link', { name: en.openAuthorization }).getAttribute('target')).toBe('_blank')
    expect(screen.getByRole('button', { name: en.cancelLogin })).toBeTruthy()

    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('preserves the receiver when React subscribes to a Host SettingsScope', async () => {
    const searchScope = new ReceiverBoundSettingsScope<AntigravitySearchSettings>({
      enabled: false,
      model: 'antigravity-gemini-3.7-flash',
      maxResults: 10,
    })

    render(
      <AntigravityAuthSettings
        rpc={rpcFixture()}
        t={key => en[key]}
        subscribe={() => () => {}}
        searchScope={searchScope}
      />,
    )

    expect(await screen.findByRole('heading', { name: en.title })).toBeTruthy()
  })

  it('renders Host-only logout controls', async () => {
    const rpc = rpcFixture(
      { phase: 'success', configured: true, projectAvailable: true, maskedEmail: 'a***@example.com' },
      true,
      { state: 'logged-in', configured: true },
      { state: 'idle' },
    )
    render(<AntigravityAuthSettings rpc={rpc} t={key => en[key]} subscribe={() => () => {}} />)

    expect(await screen.findByRole('button', { name: en.logout })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.logout }))
    await waitFor(() => expect(rpc.logout).toHaveBeenCalledOnce())
  })

  it('shows quota dashboard with groups and windows', async () => {
    const rpc = rpcFixture(
      { phase: 'success', configured: true, projectAvailable: true },
      true,
      { state: 'logged-in', configured: true },
      { state: 'idle' },
    )
    vi.mocked(rpc.usage!).mockResolvedValue({
      ok: true,
      value: {
        state: 'available',
        groups: [
          {
            group: 'gemini',
            modelCount: 2,
            windows: [
              { window: '5h', remainingFraction: 0.85, resetTime: '2030-01-01T00:00:00.000Z' },
              { window: 'weekly', remainingFraction: 0.95, resetTime: '2030-01-07T00:00:00.000Z' },
            ],
          },
        ],
      },
    })

    render(<AntigravityAuthSettings rpc={rpc} t={key => en[key]} subscribe={() => () => {}} />)

    expect(await screen.findByRole('heading', { name: en.authCardTitle })).toBeTruthy()
    expect(await screen.findByText('GEMINI MODELS')).toBeTruthy()
    expect(screen.getByText('85.00%')).toBeTruthy()
  })

  describe.each([
    {
      language: 'English',
      copy: en,
      weeklyExpected: (d: number, h: number, m: number) => `${d}d ${h}h ${m}m after refresh`,
      fiveHExpected: (h: number, m: number, s: number) => `${h}h ${m}m ${s}s after refresh`,
    },
    {
      language: 'Chinese',
      copy: zh,
      weeklyExpected: (d: number, h: number, m: number) => `${d}天${h}小时${m}分后刷新`,
      fiveHExpected: (h: number, m: number, s: number) => `${h}小时${m}分${s}秒后刷新`,
    },
  ])('$language quota reset countdown', ({ copy, weeklyExpected, fiveHExpected }) => {
    it.each([
      { minutes: 94 * 60 + 43, expected: (fn: typeof weeklyExpected) => fn(3, 22, 43) },
      { minutes: 48 * 60, expected: (fn: typeof weeklyExpected) => fn(2, 0, 0) },
      { minutes: 24 * 60, expected: (fn: typeof weeklyExpected) => fn(1, 0, 0) },
      { minutes: 24 * 60 - 1, expected: (fn: typeof weeklyExpected) => fn(0, 23, 59) },
      { minutes: 60, expected: (fn: typeof weeklyExpected) => fn(0, 1, 0) },
      { minutes: 43, expected: (fn: typeof weeklyExpected) => fn(0, 0, 43) },
      { minutes: 0.5, expected: (fn: typeof weeklyExpected) => fn(0, 0, 0) },
      { minutes: 0, expected: (fn: typeof weeklyExpected) => fn(0, 0, 0) },
      { minutes: -1, expected: (fn: typeof weeklyExpected) => fn(0, 0, 0) },
    ])('renders $minutes remaining minutes as $expected', async ({ minutes, expected }) => {
      const now = Date.parse('2026-09-10T00:00:00.000Z')
      vi.spyOn(Date, 'now').mockReturnValue(now)
      const rpc = rpcFixture(
        { phase: 'success', configured: true, projectAvailable: true },
        true,
        { state: 'logged-in', configured: true },
      )
      vi.mocked(rpc.usage!).mockResolvedValue({
        ok: true,
        value: {
          state: 'available',
          groups: [{
            group: 'gemini',
            modelCount: 2,
            windows: [
              { window: 'weekly', remainingFraction: 0.22, resetTime: new Date(now + minutes * 60_000).toISOString() },
              { window: '5h', remainingFraction: 0.85, resetTime: new Date(now + 5 * 60 * 60_000).toISOString() },
            ],
          }],
        },
      })

      render(<AntigravityAuthSettings rpc={rpc} t={key => copy[key]} subscribe={() => () => {}} />)

      expect(await screen.findByText(expected(weeklyExpected))).toBeTruthy()
      expect(screen.getByText(fiveHExpected(5, 0, 0))).toBeTruthy()
    })
  })

  it('renders the same status shell with Chinese copy', async () => {
    const rpc = rpcFixture()
    render(<AntigravityAuthSettings rpc={rpc} t={key => zh[key]} subscribe={() => () => {}} />)

    expect(await screen.findByRole('heading', { name: zh.title })).toBeTruthy()
  })

  it('translates descriptions, status, and capability controls when the language changes', async () => {
    const rpc = rpcFixture(
      { phase: 'success', configured: true, projectAvailable: true },
      true,
      { state: 'logged-in', configured: true },
    )
    const subscribe = () => () => {}
    const { container, rerender } = render(
      <AntigravityAuthSettings rpc={rpc} t={key => en[key]} subscribe={subscribe} />,
    )

    expect(await screen.findByRole('status', { name: 'Ready' })).toBeTruthy()
    expect(screen.getByText(en.intro)).toBeTruthy()
    for (const key of ['authCardIntro', 'searchCardIntro', 'imageCardIntro', 'videoCardIntro'] as const) {
      expect(screen.getByText(en[key])).toBeTruthy()
    }
    for (const key of ['toggleSearch', 'toggleImage', 'toggleVideo'] as const) {
      expect(screen.getByRole('checkbox', { name: en[key] })).toBeTruthy()
    }
    expect(container.textContent).not.toMatch(/\p{Script=Han}/u)

    rerender(<AntigravityAuthSettings rpc={rpc} t={key => zh[key]} subscribe={subscribe} />)

    expect(await screen.findByRole('status', { name: '就绪' })).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Ready' })).toBeNull()
    expect(screen.queryByText(en.intro)).toBeNull()
    expect(screen.getByText(zh.intro)).toBeTruthy()
    for (const key of ['authCardIntro', 'searchCardIntro', 'imageCardIntro', 'videoCardIntro'] as const) {
      expect(screen.getByText(zh[key])).toBeTruthy()
    }
    for (const key of ['toggleSearch', 'toggleImage', 'toggleVideo'] as const) {
      expect(screen.getByRole('checkbox', { name: zh[key] })).toBeTruthy()
    }
  })

  it('keeps complete bilingual dictionaries without Chinese text in English copy', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    expect(Object.entries(en).filter(([, value]) => /\p{Script=Han}/u.test(value))).toEqual([])
    expect([...Object.values(en), ...Object.values(zh)].every(value => value.trim().length > 0)).toBe(true)
  })

  it('renders safe pending, success, cancelled, expired, port-conflict, and failure states', async () => {
    const cases = [
      ['pending', { phase: 'pending', configured: false, projectAvailable: false, authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?state=${'a'.repeat(43)}`, expiresAt: '2026-08-21T00:00:00.000Z' }, en.openAuthorization],
      ['success', { phase: 'success', configured: true, projectAvailable: true, maskedEmail: 'a***@example.com' }, en.addAccount],
      ['cancelled', { phase: 'cancelled', configured: false, projectAvailable: false, errorCode: 'cancelled' }, en.login],
      ['expired', { phase: 'expired', configured: false, projectAvailable: false, errorCode: 'expired' }, en.loginExpired],
      ['port-conflict', { phase: 'port-conflict', configured: false, projectAvailable: false, errorCode: 'port-conflict' }, en.loginPortConflict],
      ['failed', { phase: 'failed', configured: false, projectAvailable: false, errorCode: 'project-unavailable' }, en.loginFailed],
    ] as const
    for (const [_name, login, copy] of cases) {
      const { unmount } = render(<AntigravityAuthSettings rpc={rpcFixture(login, true)} t={key => en[key]} subscribe={() => () => {}} />)
      expect((await screen.findAllByText(copy)).length).toBeGreaterThan(0)
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
    expect(screen.getByText(en.addAccount)).toBeTruthy()
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

  it('passes an unmount-scoped signal to pending browser actions', async () => {
    let actionSignal: AbortSignal | undefined
    const rpc = rpcFixture()
    rpc.login = vi.fn((_signal?: AbortSignal) => {
      actionSignal = _signal
      return new Promise<never>(() => {})
    })
    const { unmount } = render(
      <AntigravityAuthSettings rpc={rpc} t={key => en[key]} subscribe={() => () => {}} />,
    )

    await screen.findByRole('heading', { name: en.title })
    fireEvent.click(screen.getByRole('button', { name: en.login }))
    await waitFor(() => expect(actionSignal).toBeDefined())

    unmount()
    expect(actionSignal?.aborted).toBe(true)
  })

  it('renders multi-account list with radio selection and allows switching and removing accounts', async () => {
    const statusWithAccounts = createStatusView(
      true,
      { phase: 'success', configured: true, projectAvailable: true, maskedEmail: 'u***1@example.com' },
      { state: 'logged-in', configured: true },
      undefined,
      {},
      [
        { id: 'user1@example.com', email: 'user1@example.com', maskedEmail: 'u***1@example.com', projectAvailable: true, active: true },
        { id: 'user2@example.com', email: 'user2@example.com', maskedEmail: 'u***2@example.com', projectAvailable: true, active: false },
      ],
      'user1@example.com',
    )
    const switchedStatus = createStatusView(
      true,
      { phase: 'success', configured: true, projectAvailable: true, maskedEmail: 'u***2@example.com' },
      { state: 'logged-in', configured: true },
      undefined,
      {},
      [
        { id: 'user1@example.com', email: 'user1@example.com', maskedEmail: 'u***1@example.com', projectAvailable: true, active: false },
        { id: 'user2@example.com', email: 'user2@example.com', maskedEmail: 'u***2@example.com', projectAvailable: true, active: true },
      ],
      'user2@example.com',
    )
    const rpc = rpcFixture()
    rpc.status = vi.fn().mockResolvedValue({ ok: true, value: { status: statusWithAccounts } })
    rpc.switchAccount = vi.fn().mockResolvedValue({ ok: true, value: { status: switchedStatus } })
    rpc.removeAccount = vi.fn().mockResolvedValue({ ok: true, value: { status: switchedStatus } })

    const { unmount } = render(
      <AntigravityAuthSettings rpc={rpc} t={key => en[key]} subscribe={() => () => {}} />,
    )

    expect(await screen.findByText('user1@example.com')).toBeTruthy()
    expect(screen.getByText('user2@example.com')).toBeTruthy()

    // Check radio checked states
    const account1Element = screen.getByText('user1@example.com').closest('.agy-account-item')
    const account2Element = screen.getByText('user2@example.com').closest('.agy-account-item')
    expect(account1Element?.getAttribute('aria-checked')).toBe('true')
    expect(account2Element?.getAttribute('aria-checked')).toBe('false')

    // Click account 2 to switch
    expect(account2Element).toBeTruthy()
    fireEvent.click(account2Element!)
    await waitFor(() => expect(rpc.switchAccount).toHaveBeenCalledWith('user2@example.com', expect.any(AbortSignal)))

    // Click logout button on account 1 (sorted after active account user2)
    const account1Item = screen.getByText('user1@example.com').closest('.agy-account-item')!
    const logoutBtn = account1Item.querySelector('.agy-btn-logout') as HTMLButtonElement
    expect(logoutBtn).toBeTruthy()
    fireEvent.click(logoutBtn)
    await waitFor(() => expect(rpc.removeAccount).toHaveBeenCalledWith('user1@example.com', expect.any(AbortSignal)))

    unmount()
  })
})
