/** Settings shell for value-safe Antigravity login status. */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { AntigravityAuthRpcClient } from '../rpc-contract.ts'
import type { QuotaStatusView } from '../quota.ts'
import type { AntigravitySearchSettings } from '../search.ts'
import type { AntigravityImageSettings } from '../image.ts'
import type { AntigravityVideoSettings } from '../video.ts'
import type { CredentialState, RevokeState } from '../credential-coordinator.ts'
import type {
  AntigravityStatusView,
  CapabilityGateReasonCode,
  CapabilityGateState,
  CapabilityRowId,
  LoginErrorCode,
} from '../status.ts'
import type { AntigravityAuthKey } from './locales.ts'

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
  return useSyncExternalStore(
    scope?.subscribe ?? (() => () => {}),
    scope === undefined ? () => EMPTY_SETTINGS_SNAPSHOT : () => scope.getSnapshot(),
    () => EMPTY_SETTINGS_SNAPSHOT,
  ) as SettingsSnapshot & { readonly value: T | undefined }
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
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [acknowledgeBusy, setAcknowledgeBusy] = useState(false)
  const [loginBusy, setLoginBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [resetTick, setResetTick] = useState(0)

  useEffect(() => subscribe(() => { setResetTick(value => value + 1) }), [subscribe])

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadState('loading')
    setError(null)
    try {
      const result = await rpc.status(signal)
      if (signal?.aborted === true) return
      if (!result.ok) {
        setLoadState('error')
        setError(result.error.message || t('statusFailed'))
        return
      }
      setStatus(result.value.status)
      setAcknowledged(result.value.status.riskAcknowledged)
      setLoadState('ready')
    } catch (cause) {
      if (signal?.aborted === true) return
      setLoadState('error')
      setError(messageOf(cause, t('statusFailed')))
    }
  }, [rpc, t])

  const loadQuota = useCallback(async (force = false, signal?: AbortSignal) => {
    if (rpc.usage === undefined) return
    setQuotaBusy(true)
    setQuotaError(null)
    try {
      const result = await rpc.usage(signal, force)
      if (signal?.aborted === true) return
      if (!result.ok) {
        setQuotaError(result.error.message || t('quotaFailed'))
        return
      }
      setQuota(result.value)
    } catch (cause) {
      if (signal?.aborted === true) return
      setQuotaError(messageOf(cause, t('quotaFailed')))
    } finally {
      setQuotaBusy(false)
    }
  }, [rpc, t])

  useEffect(() => {
    if (status?.login.projectAvailable !== true || rpc.usage === undefined) {
      setQuota(null)
      return
    }
    const controller = new AbortController()
    void loadQuota(false, controller.signal)
    return () => controller.abort()
  }, [loadQuota, rpc.usage, status?.login.projectAvailable, resetTick])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, resetTick])

  useEffect(() => {
    if (status?.login.phase !== 'pending') return
    const controller = new AbortController()
    const timer = globalThis.setInterval(() => { void load(controller.signal) }, 1_000)
    return () => {
      globalThis.clearInterval(timer)
      controller.abort()
    }
  }, [load, status?.login.phase])

  const acknowledge = useCallback(async (checked: boolean) => {
    if (!checked) {
      setAcknowledged(false)
      return
    }
    setAcknowledgeBusy(true)
    setError(null)
    try {
      const result = await rpc.acknowledgeRisk()
      if (!result.ok) {
        setError(result.error.message || t('acknowledgeFailed'))
        return
      }
      setAcknowledged(result.value.acknowledged)
      setStatus(previous => previous === null ? previous : { ...previous, riskAcknowledged: true })
    } catch (cause) {
      setError(messageOf(cause, t('acknowledgeFailed')))
    } finally {
      setAcknowledgeBusy(false)
    }
  }, [rpc, t])

  const startLogin = useCallback(async () => {
    setLoginBusy(true)
    setError(null)
    try {
      const result = await rpc.login()
      if (!result.ok) {
        setError(result.error.message || t('loginFailed'))
        await load()
        return
      }
      setStatus(previous => {
        if (previous === null) return previous
        const { errorCode: _ignoredErrorCode, ...login } = previous.login
        return {
          ...previous,
          login: {
            ...login,
            phase: 'pending',
            authorizationUrl: result.value.authorizationUrl,
            expiresAt: result.value.expiresAt,
          },
        }
      })
    } catch (cause) {
      setError(messageOf(cause, t('loginFailed')))
    } finally {
      setLoginBusy(false)
    }
  }, [load, rpc, t])

  const cancelLogin = useCallback(async () => {
    setLoginBusy(true)
    setError(null)
    try {
      const result = await rpc.cancelLogin()
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
      setError(messageOf(cause, t('cancelLoginFailed')))
    } finally {
      setLoginBusy(false)
    }
  }, [rpc, t])

  const logout = useCallback(async () => {
    setActionBusy(true)
    setError(null)
    try {
      const result = await rpc.logout()
      if (!result.ok) {
        setError(result.error.message || t('logoutFailed'))
        return
      }
      await load()
    } catch (cause) {
      setError(messageOf(cause, t('logoutFailed')))
    } finally {
      setActionBusy(false)
    }
  }, [load, rpc, t])

  const revoke = useCallback(async () => {
    const confirm = globalThis.confirm
    if (typeof confirm === 'function' && !confirm(t('revokeConfirm'))) return
    setActionBusy(true)
    setError(null)
    try {
      const result = await rpc.revoke()
      if (!result.ok) {
        setError(result.error.message || t('revokeFailed'))
        return
      }
      if (result.value.state === 'failed') setError(t('revokeFailed'))
      if (result.value.state === 'superseded') setError(t('revokeSuperseded'))
      await load()
    } catch (cause) {
      setError(messageOf(cause, t('revokeFailed')))
    } finally {
      setActionBusy(false)
    }
  }, [load, rpc, t])

  const projectError = projectErrorText(status?.login.errorCode, t)

  return (
    <section data-plugin="dsh-antigravity-auth" aria-labelledby="antigravity-auth-title">
      <header>
        <h1 id="antigravity-auth-title">{t('title')}</h1>
        <p>{t('intro')}</p>
      </header>

      <article>
        <h2>{t('riskTitle')}</h2>
        <p>{t('risk')}</p>
        <p>
          <a href="https://antigravity.google/docs/faq/" target="_blank" rel="noreferrer">
            {t('terms')}
          </a>{' '}
          <a href="https://antigravity.google/terms/" target="_blank" rel="noreferrer">
            {t('additionalTerms')}
          </a>
        </p>
        <p>{t('singleAccount')}</p>
        <label>
          <input
            type="checkbox"
            aria-label={t('riskAcknowledgement')}
            checked={acknowledged}
            disabled={status === null || acknowledgeBusy || acknowledged}
            onChange={event => { void acknowledge(event.target.checked) }}
          />
          {acknowledgeBusy ? t('acknowledgeBusy') : t('riskAcknowledgement')}
        </label>
        {acknowledged ? <p role="status">{t('acknowledged')}</p> : null}
        {status?.login.phase === 'pending' && typeof status.login.authorizationUrl === 'string' ? (
          <p>
            <a href={status.login.authorizationUrl} target="_blank" rel="noreferrer">
              {t('openAuthorization')}
            </a>
            <button type="button" disabled={loginBusy} onClick={() => { void cancelLogin() }}>
              {t('cancelLogin')}
            </button>
          </p>
        ) : (
          <button type="button" disabled={!acknowledged || status === null || loginBusy} onClick={() => { void startLogin() }}>
            {loginBusy ? t('startingLogin') : t('login')}
          </button>
        )}
        <p role="status">{loginStatusText(status?.login.phase, acknowledged, t)}</p>
        {status?.login.phase === 'success' ? <p role="status">{t('loginSuccess')}</p> : null}
        {status?.login.phase === 'expired' ? <p role="alert">{t('loginExpired')}</p> : null}
        {status?.login.phase === 'port-conflict' ? <p role="alert">{t('loginPortConflict')}</p> : null}
        {status?.login.phase === 'failed' ? <p role="alert">{t('loginFailed')}</p> : null}
        {projectError === undefined ? null : <p role="alert">{projectError}</p>}
        {status?.login.maskedEmail === undefined ? null : (
          <p>{t('account')}: <code>{status.login.maskedEmail}</code></p>
        )}
        {status?.login.phase === 'pending' && status.login.expiresAt !== undefined ? (
          <p>{t('expiresAt')}: <time dateTime={status.login.expiresAt}>{status.login.expiresAt}</time></p>
        ) : null}
        {status?.login.configured ? (
          <p role="status">{status.login.projectAvailable ? t('projectAvailable') : t('projectUnavailable')}</p>
        ) : null}
        {status?.credential === undefined ? null : (
          <>
            <p role="status">{credentialStatusText(status.credential.state, t)}</p>
            {status.credential.configured ? (
              <p>
                <button type="button" disabled={actionBusy} onClick={() => { void logout() }}>{t('logout')}</button>{' '}
                <button type="button" disabled={actionBusy} onClick={() => { void revoke() }}>{t('revoke')}</button>
              </p>
            ) : null}
          </>
        )}
        {status?.revoke === undefined || status.revoke.state === 'idle' ? null : (
          <p role="status">{revokeStatusText(status.revoke.state, t)}</p>
        )}
      </article>

      <article>
        <h2>{t('capabilityTitle')}</h2>
        {loadState === 'loading' ? <p role="status" aria-live="polite">{t('statusLoading')}</p> : null}
        {loadState === 'error' ? (
          <p role="alert">
            {error ?? t('statusFailed')}
            <button type="button" onClick={() => { void load() }}>{t('retry')}</button>
          </p>
        ) : null}
        {status === null || loadState !== 'ready' ? null : (
          <ul>
            {status.capabilities.map(capability => (
              <li key={capability.id} data-capability={capability.id} data-state={capability.state}>
                <strong>{capabilityLabel(capability.id, t)}</strong>
                <span>{stateLabel(capability.state, t)}</span>
                <p>{reasonLabel(capability.reasonCode, t)}</p>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article aria-labelledby="antigravity-capability-settings-title">
        <h2 id="antigravity-capability-settings-title">{t('settingsTitle')}</h2>
        <CapabilityToggle
          label={t('toggleSearch')}
          snapshot={searchSettings}
          available={capabilityAvailable(status, 'search')}
          unavailableText={t('settingsUnavailable')}
          onSet={value => searchScope?.set('enabled', value) ?? Promise.resolve()}
        />
        <CapabilityToggle
          label={t('toggleImage')}
          snapshot={imageSettings}
          available={capabilityAvailable(status, 'image')}
          unavailableText={t('settingsUnavailable')}
          onSet={value => imageScope?.set('enabled', value) ?? Promise.resolve()}
        />
        <CapabilityToggle
          label={t('toggleVideo')}
          snapshot={videoSettings}
          available={capabilityAvailable(status, 'video')}
          unavailableText={t('settingsUnavailable')}
          onSet={value => videoScope?.set('enabled', value) ?? Promise.resolve()}
        />
      </article>

      <QuotaCard quota={quota} busy={quotaBusy} error={quotaError} onRefresh={() => { void loadQuota(true) }} t={t} />
    </section>
  )
}

function capabilityAvailable(status: AntigravityStatusView | null, id: CapabilityRowId): boolean {
  return status?.login.projectAvailable === true && status.capabilities.some(capability => capability.id === id && capability.state === 'available')
}

function CapabilityToggle({
  label,
  snapshot,
  available,
  unavailableText,
  onSet,
}: {
  readonly label: string
  readonly snapshot: SettingsSnapshot
  readonly available: boolean
  readonly unavailableText: string
  readonly onSet: (value: boolean) => Promise<void>
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const value = snapshot.value?.enabled ?? false
  const disabled = !available || snapshot.status !== 'ready' || !snapshot.writable || busy
  const change = async (next: boolean): Promise<void> => {
    setBusy(true)
    setWriteError(null)
    try { await onSet(next) } catch (error) { setWriteError(messageOf(error, 'Settings write failed')) } finally { setBusy(false) }
  }
  return (
    <div data-settings-toggle={label}>
      <label>
        <input type="checkbox" checked={value} disabled={disabled} onChange={event => { void change(event.target.checked) }} />
        {label}
      </label>
      {snapshot.status !== 'ready' || !snapshot.writable || !available ? <small>{unavailableText}</small> : null}
      {writeError === null ? null : <p role="alert">{writeError}</p>}
    </div>
  )
}

function QuotaCard({
  quota,
  busy,
  error,
  onRefresh,
  t,
}: {
  readonly quota: QuotaStatusView | null
  readonly busy: boolean
  readonly error: string | null
  readonly onRefresh: () => void
  readonly t: AntigravityAuthSettingsProps['t']
}): ReactNode {
  const state = quota?.state ?? 'unknown'
  return (
    <article aria-labelledby="antigravity-quota-title">
      <h2 id="antigravity-quota-title">{t('quotaTitle')}</h2>
      <p role="status">{quotaStateLabel(state, t)}</p>
      {quota?.state === 'available' && quota.groups !== undefined ? (
        <ul>
          {quota.groups.flatMap(group => group.windows.map(window => (
            <li key={`${group.group}-${window.window}`}>
              {window.window === '5h' ? t('quotaFiveHour') : t('quotaWeekly')}: {Math.round(window.remainingFraction * 100)}% · {window.resetTime}
            </li>
          )))}
        </ul>
      ) : null}
      {error === null ? null : <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={onRefresh}>{busy ? t('quotaLoading') : t('quotaRefresh')}</button>
    </article>
  )
}

function quotaStateLabel(state: QuotaStatusView['state'] | 'unknown', t: AntigravityAuthSettingsProps['t']): string {
  if (state === 'available') return t('quotaAvailable')
  if (state === 'unauthenticated') return t('quotaUnauthenticated')
  if (state === 'rate-limited') return t('quotaRateLimited')
  if (state === 'offline') return t('quotaOffline')
  if (state === 'timeout') return t('quotaOffline')
  if (state === 'protocol-drift') return t('quotaProtocolDrift')
  if (state === 'forbidden') return t('quotaForbidden')
  return t('quotaUnknown')
}

function capabilityLabel(id: CapabilityRowId, t: AntigravityAuthSettingsProps['t']): string {
  if (id === 'auth-llm') return t('authLlm')
  if (id === 'search') return t('search')
  if (id === 'image') return t('image')
  return t('video')
}

function stateLabel(state: CapabilityGateState, t: AntigravityAuthSettingsProps['t']): string {
  if (state === 'available') return t('available')
  if (state === 'disabled') return t('disabled')
  if (state === 'protocol-drift') return t('protocolDrift')
  return t('pocPending')
}

function reasonLabel(reason: CapabilityGateReasonCode, t: AntigravityAuthSettingsProps['t']): string {
  if (reason === 'login-not-implemented') return t('loginNotImplemented')
  if (reason === 'llm-not-implemented') return t('llmNotImplemented')
  if (reason === 'project-unavailable') return t('projectUnavailable')
  if (reason === 'capability-ready') return t('available')
  return t('gateNotRun')
}

function projectErrorText(
  errorCode: LoginErrorCode | undefined,
  t: AntigravityAuthSettingsProps['t'],
): string | undefined {
  if (errorCode === 'project-unavailable') return t('projectUnavailable')
  if (errorCode === 'project-authentication-failed') return t('projectAuthenticationFailed')
  if (errorCode === 'project-forbidden') return t('projectForbidden')
  if (errorCode === 'project-rate-limited') return t('projectRateLimited')
  if (errorCode === 'project-offline') return t('projectOffline')
  if (errorCode === 'project-malformed') return t('projectMalformed')
  if (errorCode === 'project-protocol-drift') return t('projectProtocolDrift')
  return undefined
}

function credentialStatusText(state: CredentialState, t: AntigravityAuthSettingsProps['t']): string {
  if (state === 'logged-in') return t('credentialLoggedIn')
  if (state === 'refreshing') return t('credentialRefreshing')
  if (state === 'refresh-failed') return t('credentialRefreshFailed')
  if (state === 're-login-required') return t('credentialReloginRequired')
  return t('credentialLoggedOut')
}

function revokeStatusText(state: RevokeState, t: AntigravityAuthSettingsProps['t']): string {
  if (state === 'pending') return t('revokePending')
  if (state === 'revoked') return t('revokeSuccess')
  if (state === 'failed') return t('revokeFailed')
  if (state === 'superseded') return t('revokeSuperseded')
  if (state === 'confirmation-required') return t('revokeConfirmationRequired')
  return t('credentialLoggedOut')
}

function loginStatusText(
  phase: AntigravityStatusView['login']['phase'] | undefined,
  acknowledged: boolean,
  t: AntigravityAuthSettingsProps['t'],
): string {
  if (!acknowledged) return t('loginRequiresAck')
  if (phase === 'pending') return t('loginPending')
  if (phase === 'success') return t('loginSuccess')
  if (phase === 'cancelled') return t('loginCancelled')
  if (phase === 'expired') return t('loginExpired')
  if (phase === 'port-conflict') return t('loginPortConflict')
  if (phase === 'failed') return t('loginFailed')
  return t('loginReady')
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback
}
