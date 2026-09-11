/** Settings shell for value-safe Antigravity login status. */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { AntigravityAuthRpcClient } from '../rpc-contract.ts'
import type { QuotaStatusView } from '../quota.ts'
import type { AntigravitySearchSettings } from '../search.ts'
import type { AntigravityImageSettings } from '../image.ts'
import type { AntigravityVideoSettings } from '../video.ts'
import type { RevokeState } from '../credential-coordinator.ts'
import type {
  AntigravityStatusView,
  CapabilityRowId,
  LoginErrorCode,
} from '../status.ts'
import type { AntigravityAuthKey } from './locales.ts'
import { ensureSettingsStyles } from './styles.ts'

export interface AntigravityAuthSettingsProps {
  rpc: AntigravityAuthRpcClient
  t: (key: AntigravityAuthKey) => string
  subscribe: (listener: () => void) => () => void
  searchScope?: SettingsScope<AntigravitySearchSettings>
  imageScope?: SettingsScope<AntigravityImageSettings>
  videoScope?: SettingsScope<AntigravityVideoSettings>
}

type LoadState = 'loading' | 'ready' | 'error'
type BooleanSettings = { readonly enabled: boolean }
type SettingsSnapshot = ReturnType<SettingsScope<BooleanSettings>['getSnapshot']>
const EMPTY_SETTINGS_SNAPSHOT: SettingsSnapshot = { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'memory' }

function useCapabilitySettings<T extends BooleanSettings>(scope: SettingsScope<T> | undefined): SettingsSnapshot & { readonly value: T | undefined } {
  const subscribe = useCallback((listener: () => void) => scope?.subscribe(listener) ?? (() => {}), [scope])
  const getSnapshot = useCallback(() => scope?.getSnapshot() ?? EMPTY_SETTINGS_SNAPSHOT, [scope])
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SETTINGS_SNAPSHOT) as SettingsSnapshot & { readonly value: T | undefined }
}

function useUnmountSignal(): () => AbortSignal {
  const controller = useRef(new AbortController())
  useEffect(() => {
    const active = new AbortController()
    controller.current = active
    return () => active.abort()
  }, [])
  return useCallback(() => controller.current.signal, [])
}

/** One navigable settings section; credentials remain Host-only and actions use typed RPC. */
export function AntigravityAuthSettings({ rpc, t, subscribe, searchScope, imageScope, videoScope }: AntigravityAuthSettingsProps): ReactNode {
  const [status, setStatus] = useState<AntigravityStatusView | null>(null)
  const searchSettings = useCapabilitySettings(searchScope)
  const imageSettings = useCapabilitySettings(imageScope)
  const videoSettings = useCapabilitySettings(videoScope)
  const [quota, setQuota] = useState<QuotaStatusView | null>(null)
  const [quotaBusy, setQuotaBusy] = useState(false)
  const [quotaError, setQuotaError] = useState<string | null>(null)
  const [accountQuotas, setAccountQuotas] = useState<Record<string, QuotaStatusView>>({})
  const [accountQuotaBusy, setAccountQuotaBusy] = useState<Record<string, boolean>>({})
  const [accountQuotaErrors, setAccountQuotaErrors] = useState<Record<string, string | null>>({})
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [_error, setError] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [resetTick, setResetTick] = useState(0)
  const statusGeneration = useRef(0)
  const quotaGeneration = useRef(0)
  const unmountSignal = useUnmountSignal()

  useEffect(() => {
    ensureSettingsStyles()
  }, [])

  useEffect(() => subscribe(() => { setResetTick(value => value + 1) }), [subscribe])

  const load = useCallback(async (signal?: AbortSignal, silent = false) => {
    const generation = ++statusGeneration.current
    if (!silent) {
      setLoadState(prev => (prev === 'ready' ? 'ready' : 'loading'))
      setError(null)
    }
    try {
      const result = await rpc.status(signal)
      if (signal?.aborted === true || generation !== statusGeneration.current) return
      if (!result.ok) {
        setLoadState('error')
        setError(result.error.message || t('statusFailed'))
        return
      }
      setStatus(result.value.status)
      setLoadState('ready')
    } catch (cause) {
      if (signal?.aborted === true || generation !== statusGeneration.current) return
      setLoadState('error')
      setError(messageOf(cause, t('statusFailed')))
    }
  }, [rpc, t])

  const loadQuotaForAccount = useCallback(async (accountId: string, force = false, signal?: AbortSignal) => {
    if (rpc.usage === undefined) return
    setAccountQuotaBusy(prev => ({ ...prev, [accountId]: true }))
    setAccountQuotaErrors(prev => ({ ...prev, [accountId]: null }))
    try {
      const result = await rpc.usage(signal, force, accountId)
      if (signal?.aborted === true) return
      if (!result.ok) {
        setAccountQuotaErrors(prev => ({ ...prev, [accountId]: result.error.message || t('quotaFailed') }))
        return
      }
      setAccountQuotas(prev => ({ ...prev, [accountId]: result.value }))
      if (status?.activeAccountId === accountId) {
        setQuota(result.value)
      }
    } catch (cause) {
      if (signal?.aborted === true) return
      setAccountQuotaErrors(prev => ({ ...prev, [accountId]: messageOf(cause, t('quotaFailed')) }))
    } finally {
      if (signal?.aborted !== true) {
        setAccountQuotaBusy(prev => ({ ...prev, [accountId]: false }))
      }
    }
  }, [rpc, status?.activeAccountId, t])

  const loadQuota = useCallback(async (force = false, signal?: AbortSignal) => {
    if (rpc.usage === undefined) return
    const activeId = status?.activeAccountId
    if (activeId) {
      await loadQuotaForAccount(activeId, force, signal)
    } else {
      const generation = ++quotaGeneration.current
      setQuotaBusy(true)
      setQuotaError(null)
      try {
        const result = await rpc.usage(signal, force)
        if (signal?.aborted === true || generation !== quotaGeneration.current) return
        if (!result.ok) {
          setQuotaError(result.error.message || t('quotaFailed'))
          return
        }
        setQuota(result.value)
      } catch (cause) {
        if (signal?.aborted === true || generation !== quotaGeneration.current) return
        setQuotaError(messageOf(cause, t('quotaFailed')))
      } finally {
        if (signal?.aborted !== true && generation === quotaGeneration.current) setQuotaBusy(false)
      }
    }
  }, [loadQuotaForAccount, rpc, status?.activeAccountId, t])

  useEffect(() => {
    if (rpc.usage === undefined) return
    const accounts = status?.accounts
    if (accounts && accounts.length > 0) {
      const controller = new AbortController()
      for (const acc of accounts) {
        void loadQuotaForAccount(acc.id, false, controller.signal)
      }
      return () => controller.abort()
    }
    if (status?.login.projectAvailable === true) {
      const controller = new AbortController()
      void loadQuota(false, controller.signal)
      return () => controller.abort()
    }
    setQuota(null)
  }, [loadQuota, loadQuotaForAccount, rpc.usage, status?.accounts, status?.login.projectAvailable, resetTick])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, resetTick])

  useEffect(() => {
    if (status?.login.phase !== 'pending') return
    const controller = new AbortController()
    const timer = globalThis.setInterval(() => { void load(controller.signal, true) }, 1_000)
    return () => {
      globalThis.clearInterval(timer)
      controller.abort()
    }
  }, [load, status?.login.phase])

  const startLogin = useCallback(async () => {
    const signal = unmountSignal()
    setLoginBusy(true)
    setError(null)
    try {
      if (status?.riskAcknowledged !== true) {
        await rpc.acknowledgeRisk(signal)
      }
      const result = await rpc.login(signal)
      if (signal.aborted) return
      if (!result.ok) {
        setError(result.error.message || t('loginFailed'))
        await load(signal)
        return
      }
      setStatus(previous => {
        if (previous === null) return previous
        const { errorCode: _ignoredErrorCode, ...login } = previous.login
        return {
          ...previous,
          riskAcknowledged: true,
          login: {
            ...login,
            phase: 'pending',
            authorizationUrl: result.value.authorizationUrl,
            expiresAt: result.value.expiresAt,
          },
        }
      })
    } catch (cause) {
      if (!signal.aborted) setError(messageOf(cause, t('loginFailed')))
    } finally {
      if (!signal.aborted) setLoginBusy(false)
    }
  }, [load, rpc, status?.riskAcknowledged, t, unmountSignal])

  const cancelLogin = useCallback(async () => {
    const signal = unmountSignal()
    setLoginBusy(true)
    setError(null)
    try {
      const result = await rpc.cancelLogin(signal)
      if (signal.aborted) return
      if (!result.ok) {
        setError(result.error.message || t('cancelLoginFailed'))
        return
      }
      setStatus(previous => {
        if (previous === null) return previous
        const { errorCode: _ignoredErrorCode, ...login } = previous.login
        return {
          ...previous,
          login: result.value.errorCode === undefined
            ? { ...login, phase: result.value.phase }
            : { ...login, phase: result.value.phase, errorCode: result.value.errorCode },
        }
      })
    } catch (cause) {
      if (!signal.aborted) setError(messageOf(cause, t('cancelLoginFailed')))
    } finally {
      if (!signal.aborted) setLoginBusy(false)
    }
  }, [rpc, t, unmountSignal])

  const logout = useCallback(async () => {
    const signal = unmountSignal()
    setActionBusy(true)
    setError(null)
    try {
      const result = await rpc.logout(signal)
      if (signal.aborted) return
      if (!result.ok) {
        setError(result.error.message || t('logoutFailed'))
        return
      }
      await load(signal)
    } catch (cause) {
      if (!signal.aborted) setError(messageOf(cause, t('logoutFailed')))
    } finally {
      if (!signal.aborted) setActionBusy(false)
    }
  }, [load, rpc, t, unmountSignal])

  const switchAccount = useCallback(async (accountId: string) => {
    if (rpc.switchAccount === undefined) return
    const signal = unmountSignal()
    setActionBusy(true)
    setError(null)
    try {
      const result = await rpc.switchAccount(accountId, signal)
      if (signal.aborted) return
      if (!result.ok) {
        setError(result.error.message || t('switchAccountFailed'))
        return
      }
      setStatus(result.value.status)
      void loadQuotaForAccount(accountId, true, signal)
    } catch (cause) {
      if (!signal.aborted) setError(messageOf(cause, t('switchAccountFailed')))
    } finally {
      if (!signal.aborted) setActionBusy(false)
    }
  }, [loadQuotaForAccount, rpc, t, unmountSignal])

  const removeAccount = useCallback(async (accountId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const signal = unmountSignal()
    setActionBusy(true)
    setError(null)
    try {
      if (rpc.removeAccount !== undefined) {
        const result = await rpc.removeAccount(accountId, signal)
        if (signal.aborted) return
        if (!result.ok) {
          setError(result.error.message || t('removeAccountFailed'))
          return
        }
        setStatus(result.value.status)
        setAccountQuotas(prev => {
          const next = { ...prev }
          delete next[accountId]
          return next
        })
        const newActive = result.value.status.activeAccountId
        if (newActive) {
          void loadQuotaForAccount(newActive, true, signal)
        }
      } else {
        const result = await rpc.logout(signal)
        if (signal.aborted) return
        if (!result.ok) {
          setError(result.error.message || t('logoutFailed'))
          return
        }
        await load(signal)
      }
    } catch (cause) {
      if (!signal.aborted) setError(messageOf(cause, t('removeAccountFailed')))
    } finally {
      if (!signal.aborted) setActionBusy(false)
    }
  }, [load, loadQuotaForAccount, rpc, t, unmountSignal])

  const projectError = projectErrorText(status?.login.errorCode, t)
  const isConfigured = status?.login.configured === true

  const sortedAccounts = useMemo(() => {
    if (!status?.accounts || status.accounts.length <= 1) return status?.accounts ?? []
    return [...status.accounts].sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0))
  }, [status?.accounts])

  return (
    <section className="agy-settings" data-plugin="dsh-antigravity-auth" aria-labelledby="antigravity-auth-title">
      <header className="agy-bundle-header">
        <div>
          <div className="agy-title-line">
            <h1 id="antigravity-auth-title" className="agy-bundle-title">{t('title')}</h1>
          </div>
          <p className="agy-bundle-intro">{t('intro')}</p>
        </div>
        {isConfigured ? (
          <button
            type="button"
            className="agy-btn agy-btn-relogin agy-header-relogin-btn"
            disabled={loginBusy || actionBusy}
            onClick={() => { void startLogin() }}
          >
            {t('addAccount')}
          </button>
        ) : null}
      </header>

      <div className="agy-cards">
        {/* Pending Authorization Banner when adding an account while accounts already exist */}
        {status?.accounts && status.accounts.length > 0 && status.login.phase === 'pending' && typeof status.login.authorizationUrl === 'string' ? (
          <article className="agy-card agy-pending-banner">
            <div className="agy-card-header">
              <div className="agy-card-identity">
                <h2 className="agy-card-title">{t('loginPending')}</h2>
                <p className="agy-card-intro">{t('terms')}</p>
              </div>
            </div>
            <div className="agy-account-actions-row">
              <div className="agy-account-left-actions">
                <a className="agy-btn agy-btn-relogin" href={status.login.authorizationUrl} target="_blank" rel="noreferrer">
                  {t('openAuthorization')}
                </a>
                <button className="agy-btn agy-btn-logout" type="button" disabled={loginBusy} onClick={() => { void cancelLogin() }}>
                  {t('cancelLogin')}
                </button>
              </div>
            </div>
            {status.login.expiresAt !== undefined ? (
              <p className="agy-card-subtext">{t('expiresAt')}: <time dateTime={status.login.expiresAt}>{status.login.expiresAt}</time></p>
            ) : null}
          </article>
        ) : null}

        {/* Multi-Account Cards matching reference design */}
        {status !== null && sortedAccounts.length > 0 ? (
          sortedAccounts.map(account => {
            const isSelected = account.active
            const accountQuota = accountQuotas[account.id] ?? (isSelected ? quota : null)
            const isAccountBusy = accountQuotaBusy[account.id] ?? (isSelected ? quotaBusy : false)
            const accountError = accountQuotaErrors[account.id] ?? (isSelected ? quotaError : null)
            return (
              <article
                key={account.id}
                className={`agy-card agy-account-card agy-account-item ${isSelected ? 'agy-account-active' : ''}`}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onClick={() => {
                  if (!isSelected && !actionBusy) {
                    void switchAccount(account.id)
                  }
                }}
                onKeyDown={e => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isSelected && !actionBusy) {
                    e.preventDefault()
                    void switchAccount(account.id)
                  }
                }}
              >
                <div className="agy-card-header">
                  <div className="agy-card-identity">
                    <h2 className="agy-account-card-title">
                      <span>{account.email ?? account.maskedEmail ?? account.id}</span>
                      {isSelected ? (
                        <span className="agy-status-dot" role="status" aria-label="Active" />
                      ) : null}
                    </h2>
                    <p className="agy-card-intro">{t('authCardIntro')}</p>
                  </div>
                </div>

                <QuotaVisualDashboard
                  quota={accountQuota}
                  busy={isAccountBusy}
                  error={accountError}
                  onRefresh={() => { void loadQuotaForAccount(account.id, true, unmountSignal()) }}
                  t={t}
                />

                <div className="agy-account-actions-row">
                  <button
                    className="agy-btn agy-btn-ghost agy-refresh-btn"
                    type="button"
                    disabled={loadState === 'loading' || isAccountBusy}
                    onClick={e => {
                      e.stopPropagation()
                      const minDelay = new Promise(resolve => setTimeout(resolve, 500))
                      void Promise.all([load(unmountSignal()), loadQuotaForAccount(account.id, true, unmountSignal()), minDelay])
                    }}
                  >
                    <span className={`agy-refresh-icon ${isAccountBusy || loadState === 'loading' ? 'agy-spin-icon' : ''}`}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
                    </span>
                    <span>{isAccountBusy || loadState === 'loading' ? t('queryingQuota') : t('refreshStatus')}</span>
                  </button>

                  <button
                    className="agy-btn agy-btn-logout"
                    type="button"
                    disabled={actionBusy}
                    onClick={e => {
                      e.stopPropagation()
                      void removeAccount(account.id, e)
                    }}
                  >
                    {t('logout')}
                  </button>
                </div>

                {isSelected && status.login.phase === 'expired' ? <p className="agy-alert" role="alert">{t('loginExpired')}</p> : null}
                {isSelected && status.login.phase === 'port-conflict' ? <p className="agy-alert" role="alert">{t('loginPortConflict')}</p> : null}
                {isSelected && status.login.phase === 'failed' ? <p className="agy-alert" role="alert">{t('loginFailed')}</p> : null}
                {isSelected && projectError !== undefined ? <p className="agy-alert" role="alert">{projectError}</p> : null}
                {isSelected && status.revoke !== undefined && status.revoke.state !== 'idle' ? (
                  <p className="agy-card-subtext" role="status">{revokeStatusText(status.revoke.state, t)}</p>
                ) : null}
              </article>
            )
          })
        ) : (
          /* Single Fallback Card (unauthenticated state) */
          <article className="agy-card" aria-labelledby="antigravity-auth-card-title">
            <div className="agy-card-header">
              <div className="agy-card-identity">
                <h2 id="antigravity-auth-card-title" className="agy-card-title">{t('authCardTitle')}</h2>
                <p className="agy-card-intro">{t('authCardIntro')}</p>
              </div>
            </div>

            <QuotaVisualDashboard
              quota={quota}
              busy={quotaBusy}
              error={quotaError}
              onRefresh={() => { void loadQuota(true, unmountSignal()) }}
              t={t}
            />

            <div className="agy-account-actions-row">
              <div className="agy-account-left-actions">
                {status?.login.phase === 'pending' && typeof status.login.authorizationUrl === 'string' ? (
                  <>
                    <a className="agy-btn agy-btn-relogin" href={status.login.authorizationUrl} target="_blank" rel="noreferrer">
                      {t('openAuthorization')}
                    </a>
                    <button className="agy-btn agy-btn-logout" type="button" disabled={loginBusy} onClick={() => { void cancelLogin() }}>
                      {t('cancelLogin')}
                    </button>
                  </>
                ) : (
                  <button className="agy-btn agy-btn-relogin" type="button" disabled={status === null || loginBusy} onClick={() => { void startLogin() }}>
                    {loginBusy ? t('startingLogin') : isConfigured ? t('relogin') : t('login')}
                  </button>
                )}

                <button
                  className="agy-btn agy-btn-ghost agy-refresh-btn"
                  type="button"
                  disabled={loadState === 'loading' || quotaBusy}
                  onClick={() => {
                    const minDelay = new Promise(resolve => setTimeout(resolve, 500))
                    void Promise.all([load(unmountSignal()), loadQuota(true, unmountSignal()), minDelay])
                  }}
                >
                  <span className={`agy-refresh-icon ${quotaBusy || loadState === 'loading' ? 'agy-spin-icon' : ''}`}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
                  </span>
                  {quotaBusy || loadState === 'loading' ? t('queryingQuota') : t('refreshStatus')}
                </button>
              </div>

              {status?.credential?.configured ? (
                <button className="agy-btn agy-btn-logout" type="button" disabled={actionBusy} onClick={() => { void logout() }}>
                  {t('logout')}
                </button>
              ) : null}
            </div>

            {status?.login.phase === 'expired' ? <p className="agy-alert" role="alert">{t('loginExpired')}</p> : null}
            {status?.login.phase === 'port-conflict' ? <p className="agy-alert" role="alert">{t('loginPortConflict')}</p> : null}
            {status?.login.phase === 'failed' ? <p className="agy-alert" role="alert">{t('loginFailed')}</p> : null}
            {projectError === undefined ? null : <p className="agy-alert" role="alert">{projectError}</p>}
            {status?.login.phase === 'pending' && status.login.expiresAt !== undefined ? (
              <p className="agy-card-subtext">{t('expiresAt')}: <time dateTime={status.login.expiresAt}>{status.login.expiresAt}</time></p>
            ) : null}
            {status?.revoke === undefined || status.revoke.state === 'idle' ? null : (
              <p className="agy-card-subtext" role="status">{revokeStatusText(status.revoke.state, t)}</p>
            )}
          </article>
        )}

        {/* Card 2: Web Search */}
        <article className="agy-card">
          <div className="agy-card-header">
            <div className="agy-card-identity">
              <h2 className="agy-card-title">{t('search')}</h2>
              <p className="agy-card-intro">{t('searchCardIntro')}</p>
            </div>
            <div className="agy-card-action">
              <Switch
                checked={searchSettings.value?.enabled ?? false}
                disabled={!capabilityAvailable(status, 'search') || searchSettings.status !== 'ready' || !searchSettings.writable}
                onChange={next => { void searchScope?.set('enabled', next) }}
              />
            </div>
          </div>
        </article>

        {/* Card 3: Image Creation */}
        <article className="agy-card">
          <div className="agy-card-header">
            <div className="agy-card-identity">
              <h2 className="agy-card-title">{t('image')}</h2>
              <p className="agy-card-intro">{t('imageCardIntro')}</p>
            </div>
            <div className="agy-card-action">
              <Switch
                checked={imageSettings.value?.enabled ?? false}
                disabled={!capabilityAvailable(status, 'image') || imageSettings.status !== 'ready' || !imageSettings.writable}
                onChange={next => { void imageScope?.set('enabled', next) }}
              />
            </div>
          </div>
        </article>

        {/* Card 4: Video Analysis */}
        <article className="agy-card">
          <div className="agy-card-header">
            <div className="agy-card-identity">
              <h2 className="agy-card-title">{t('video')}</h2>
              <p className="agy-card-intro">{t('videoCardIntro')}</p>
            </div>
            <div className="agy-card-action">
              <Switch
                checked={videoSettings.value?.enabled ?? false}
                disabled={!capabilityAvailable(status, 'video') || videoSettings.status !== 'ready' || !videoSettings.writable}
                onChange={next => { void videoScope?.set('enabled', next) }}
              />
            </div>
          </div>
        </article>
      </div>
    </section>
  )
}

function capabilityAvailable(status: AntigravityStatusView | null, id: CapabilityRowId): boolean {
  return status?.login.projectAvailable === true && status.capabilities.some(capability => capability.id === id && capability.state === 'available')
}

function Switch({
  checked,
  disabled,
  onChange,
}: {
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onChange: (checked: boolean) => void
}): ReactNode {
  return (
    <label className="agy-switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => { onChange(e.target.checked) }}
      />
      <span className="agy-switch-slider" />
    </label>
  )
}

function formatRefreshTime(resetTime: string, now = Date.now()): string {
  const target = new Date(resetTime).getTime()
  if (Number.isNaN(target)) return resetTime
  const diffMs = target - now
  if (diffMs <= 0) return '0m'
  const diffMinutes = Math.floor(diffMs / (60 * 1000))
  const hours = Math.floor(diffMinutes / 60)
  const remMinutes = diffMinutes % 60

  if (hours >= 24) {
    return `${hours}h ${remMinutes}m`
  }
  if (hours > 0) {
    return `${hours}h ${remMinutes}m`
  }
  return `${remMinutes}m`
}

function formatRefreshLabel(resetTime: string, template: string, now = Date.now()): string {
  const target = new Date(resetTime).getTime()
  if (Number.isNaN(target)) return template
  const diffMs = Math.max(0, target - now)
  const totalSeconds = Math.floor(diffMs / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return template
    .replace('{days}', String(days))
    .replace('{hours}', String(hours))
    .replace('{minutes}', String(minutes))
    .replace('{seconds}', String(seconds))
}

function quotaTone(fraction: number): 'normal' | 'warning' | 'error' {
  if (fraction < 0.3) return 'error'
  if (fraction <= 0.6) return 'warning'
  return 'normal'
}

function QuotaVisualDashboard({
  quota,
  busy,
  error,
  isInactive,
  t,
}: {
  readonly quota: QuotaStatusView | null
  readonly busy?: boolean
  readonly error: string | null
  readonly isInactive?: boolean
  readonly onRefresh?: () => void
  readonly t: AntigravityAuthSettingsProps['t']
}): ReactNode {
  return (
    <div className="agy-quota-section">
      {quota?.state === 'available' && quota.groups !== undefined && quota.groups.length > 0 ? (
        <div className="agy-quota-groups">
          {quota.groups.map(group => {
            const groupTitle = group.group === 'gemini' ? t('geminiGroupTitle') : t('claudeGptGroupTitle')
            const groupDesc = group.group === 'gemini' ? t('geminiGroupDesc') : t('claudeGptGroupDesc')
            return (
              <div key={group.group} className="agy-quota-group">
                <div className="agy-quota-group-header">
                  <span className="agy-quota-group-title">{groupTitle}</span>
                  <span className="agy-quota-group-desc">{groupDesc}</span>
                </div>
                <div className="agy-quota-buckets">
                   {group.windows.map(window => {
                    const windowLabel = window.window === '5h' ? t('quotaFiveHour') : t('quotaWeekly')
                    const windowTemplate = window.window === '5h' ? t('window5hTitle') : t('windowWeeklyTitle')
                    const pctFormatted = (window.remainingFraction * 100).toFixed(2) + '%'
                    const refreshLabel = formatRefreshLabel(window.resetTime, windowTemplate)
                    const widthPct = Math.max(0, Math.min(100, window.remainingFraction * 100))
                    const tone = quotaTone(window.remainingFraction)

                    return (
                      <div key={window.window} className="agy-quota-bucket">
                        <div className="agy-quota-bucket-head">
                          <span className="agy-quota-bucket-name">{windowLabel}</span>
                          {busy ? (
                            <span className="agy-quota-querying">
                              <span className="agy-querying-spinner" aria-hidden="true" />
                              <span>{t('queryingQuota')}</span>
                            </span>
                          ) : (
                            <span className="agy-quota-bucket-val" data-tone={tone}>{pctFormatted}</span>
                          )}
                        </div>
                        <div className="agy-progress-track">
                          {busy ? (
                            <div className="agy-shimmer-track" aria-hidden="true" />
                          ) : (
                            <div className="agy-progress-bar" data-tone={tone} style={{ width: `${widthPct}%` }} />
                          )}
                        </div>
                        <span className="agy-quota-subtext">{refreshLabel}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : busy ? (
        <div className="agy-quota-loading-state" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', gap: '8px', color: 'var(--dsw-alias-label-tertiary, #71717a)', fontSize: '13px' }}>
          <span className="agy-spin-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
          </span>
          <span>{t('queryingQuota')}</span>
        </div>
      ) : null}
      {error === null ? null : <p className="agy-alert" role="alert">{error}</p>}
    </div>
  )
}

const PROJECT_ERROR_KEYS: Readonly<Partial<Record<LoginErrorCode, AntigravityAuthKey>>> = {
  'project-unavailable': 'projectUnavailable',
  'project-authentication-failed': 'projectAuthenticationFailed',
  'project-forbidden': 'projectForbidden',
  'project-rate-limited': 'projectRateLimited',
  'project-offline': 'projectOffline',
  'project-malformed': 'projectMalformed',
  'project-protocol-drift': 'projectProtocolDrift',
}
const REVOKE_STATE_KEYS: Readonly<Record<RevokeState, AntigravityAuthKey>> = {
  idle: 'credentialLoggedOut',
  'logged-out': 'credentialLoggedOut',
  pending: 'revokePending',
  revoked: 'revokeSuccess',
  failed: 'revokeFailed',
  superseded: 'revokeSuperseded',
  'confirmation-required': 'revokeConfirmationRequired',
}

function projectErrorText(errorCode: LoginErrorCode | undefined, t: AntigravityAuthSettingsProps['t']): string | undefined {
  if (errorCode === undefined) return undefined
  const key = PROJECT_ERROR_KEYS[errorCode]
  return key === undefined ? undefined : t(key)
}

function revokeStatusText(state: RevokeState, t: AntigravityAuthSettingsProps['t']): string {
  return t(REVOKE_STATE_KEYS[state])
}

function messageOf(_error: unknown, fallback: string): string {
  return fallback
}
