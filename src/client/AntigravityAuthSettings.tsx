/** Settings shell for value-safe Antigravity login status. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { AntigravityAuthRpcClient } from '../rpc-contract.ts'
import type { QuotaStatusView } from '../quota.ts'
import type { AntigravityModelCatalogView, AntigravityModelAvailability } from '../model-catalog.ts'
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
  const [models, setModels] = useState<AntigravityModelCatalogView | null>(null)
  const [modelsBusy, setModelsBusy] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
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
  const statusGeneration = useRef(0)
  const modelGeneration = useRef(0)
  const quotaGeneration = useRef(0)
  const unmountSignal = useUnmountSignal()
  const hasStatus = status !== null
  const modelGateReady = capabilityAvailable(status, 'auth-llm')

  useEffect(() => subscribe(() => { setResetTick(value => value + 1) }), [subscribe])

  const load = useCallback(async (signal?: AbortSignal) => {
    const generation = ++statusGeneration.current
    setLoadState('loading')
    setError(null)
    try {
      const result = await rpc.status(signal)
      if (signal?.aborted === true || generation !== statusGeneration.current) return
      if (!result.ok) {
        setLoadState('error')
        setError(result.error.message || t('statusFailed'))
        return
      }
      setStatus(result.value.status)
      setAcknowledged(result.value.status.riskAcknowledged)
      setLoadState('ready')
    } catch (cause) {
      if (signal?.aborted === true || generation !== statusGeneration.current) return
      setLoadState('error')
      setError(messageOf(cause, t('statusFailed')))
    }
  }, [rpc, t])

  const loadModels = useCallback(async (force = false, signal?: AbortSignal) => {
    const generation = ++modelGeneration.current
    setModelsBusy(true)
    setModelsError(null)
    try {
      const result = await rpc.models(signal, force)
      if (signal?.aborted === true || generation !== modelGeneration.current) return
      if (!result.ok) {
        setModelsError(result.error.message || t('modelsFailed'))
        return
      }
      setModels(result.value)
    } catch (cause) {
      if (signal?.aborted === true || generation !== modelGeneration.current) return
      setModelsError(messageOf(cause, t('modelsFailed')))
    } finally {
      if (signal?.aborted !== true && generation === modelGeneration.current) setModelsBusy(false)
    }
  }, [rpc, t])

  const loadQuota = useCallback(async (force = false, signal?: AbortSignal) => {
    if (rpc.usage === undefined) return
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
  }, [rpc, t])

  useEffect(() => {
    if (!hasStatus) return
    const controller = new AbortController()
    void loadModels(false, controller.signal)
    return () => controller.abort()
  }, [hasStatus, loadModels, modelGateReady, resetTick])

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
    const signal = unmountSignal()
    setAcknowledgeBusy(true)
    setError(null)
    try {
      const result = await rpc.acknowledgeRisk(signal)
      if (signal.aborted) return
      if (!result.ok) {
        setError(result.error.message || t('acknowledgeFailed'))
        return
      }
      setAcknowledged(result.value.acknowledged)
      setStatus(previous => previous === null ? previous : { ...previous, riskAcknowledged: true })
    } catch (cause) {
      if (!signal.aborted) setError(messageOf(cause, t('acknowledgeFailed')))
    } finally {
      if (!signal.aborted) setAcknowledgeBusy(false)
    }
  }, [rpc, t, unmountSignal])

  const startLogin = useCallback(async () => {
    const signal = unmountSignal()
    setLoginBusy(true)
    setError(null)
    try {
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
  }, [load, rpc, t, unmountSignal])

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

  const revoke = useCallback(async () => {
    const confirm = globalThis.confirm
    if (typeof confirm === 'function' && !confirm(t('revokeConfirm'))) return
    const signal = unmountSignal()
    setActionBusy(true)
    setError(null)
    try {
      const result = await rpc.revoke(signal)
      if (signal.aborted) return
      if (!result.ok) {
        setError(result.error.message || t('revokeFailed'))
        return
      }
      if (result.value.state === 'failed') setError(t('revokeFailed'))
      if (result.value.state === 'superseded') setError(t('revokeSuperseded'))
      await load(signal)
    } catch (cause) {
      if (!signal.aborted) setError(messageOf(cause, t('revokeFailed')))
    } finally {
      if (!signal.aborted) setActionBusy(false)
    }
  }, [load, rpc, t, unmountSignal])

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
            <button type="button" onClick={() => { void load(unmountSignal()) }}>{t('retry')}</button>
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

      <ModelCatalogCard
        catalog={models}
        busy={modelsBusy}
        error={modelsError}
        canRefresh={modelGateReady}
        onRefresh={() => { void loadModels(true, unmountSignal()) }}
        t={t}
      />
      <QuotaCard quota={quota} busy={quotaBusy} error={quotaError} onRefresh={() => { void loadQuota(true, unmountSignal()) }} t={t} />
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

function ModelCatalogCard({
  catalog,
  busy,
  error,
  canRefresh,
  onRefresh,
  t,
}: {
  readonly catalog: AntigravityModelCatalogView | null
  readonly busy: boolean
  readonly error: string | null
  readonly canRefresh: boolean
  readonly onRefresh: () => void
  readonly t: AntigravityAuthSettingsProps['t']
}): ReactNode {
  return (
    <article aria-labelledby="antigravity-models-title">
      <h2 id="antigravity-models-title">{t('modelsTitle')}</h2>
      <p role="status">{modelCatalogStateLabel(catalog?.state ?? 'snapshot', t)}</p>
      {catalog === null ? null : (
        <ul>
          {catalog.models.map(model => (
            <li key={model.id} data-model={model.id} data-state={model.state}>
              <strong>{model.name}</strong>: {modelAvailabilityLabel(model.state, t)}
            </li>
          ))}
        </ul>
      )}
      {error === null ? null : <p role="alert">{error}</p>}
      <button type="button" disabled={busy || !canRefresh} onClick={onRefresh}>
        {busy ? t('modelsLoading') : t('modelsRefresh')}
      </button>
    </article>
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

const QUOTA_STATE_KEYS: Readonly<Record<QuotaStatusView['state'] | 'unknown', AntigravityAuthKey>> = {
  available: 'quotaAvailable',
  unauthenticated: 'quotaUnauthenticated',
  forbidden: 'quotaForbidden',
  'rate-limited': 'quotaRateLimited',
  offline: 'quotaOffline',
  timeout: 'quotaOffline',
  'protocol-drift': 'quotaProtocolDrift',
  unknown: 'quotaUnknown',
}
const CAPABILITY_KEYS: Readonly<Record<CapabilityRowId, AntigravityAuthKey>> = { 'auth-llm': 'authLlm', search: 'search', image: 'image', video: 'video' }
const CAPABILITY_STATE_KEYS: Readonly<Record<CapabilityGateState, AntigravityAuthKey>> = { available: 'available', disabled: 'disabled', 'poc-pending': 'pocPending', 'protocol-drift': 'protocolDrift' }
const CAPABILITY_REASON_KEYS: Readonly<Record<CapabilityGateReasonCode, AntigravityAuthKey>> = {
  'gate-not-run': 'gateNotRun',
  'project-unavailable': 'projectUnavailable',
  'capability-ready': 'available',
  unauthenticated: 'gateUnauthenticated',
  'rate-limited': 'gateRateLimited',
  cancelled: 'gateCancelled',
  'gate-0-failed': 'gate0Failed',
  'gate-failed': 'gateFailed',
  'unsupported-video': 'unsupportedVideo',
  'protocol-drift': 'protocolDrift',
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
const CREDENTIAL_STATE_KEYS: Readonly<Record<CredentialState, AntigravityAuthKey>> = {
  'logged-in': 'credentialLoggedIn',
  refreshing: 'credentialRefreshing',
  'refresh-failed': 'credentialRefreshFailed',
  're-login-required': 'credentialReloginRequired',
  'logged-out': 'credentialLoggedOut',
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
const LOGIN_PHASE_KEYS: Readonly<Record<AntigravityStatusView['login']['phase'], AntigravityAuthKey>> = {
  idle: 'loginReady',
  pending: 'loginPending',
  success: 'loginSuccess',
  cancelled: 'loginCancelled',
  expired: 'loginExpired',
  'port-conflict': 'loginPortConflict',
  failed: 'loginFailed',
}

const MODEL_CATALOG_STATE_KEYS: Readonly<Record<AntigravityModelCatalogView['state'], AntigravityAuthKey>> = {
  snapshot: 'modelsSnapshot',
  'live-available': 'modelsLiveAvailable',
  'refresh-failed': 'modelsRefreshFailed',
  'protocol-drift': 'modelsProtocolDrift',
}
const MODEL_AVAILABILITY_KEYS: Readonly<Record<AntigravityModelAvailability, AntigravityAuthKey>> = {
  snapshot: 'modelsSnapshotEntry',
  'live-available': 'modelsAvailableEntry',
  unavailable: 'modelsUnavailableEntry',
}

function modelCatalogStateLabel(state: AntigravityModelCatalogView['state'], t: AntigravityAuthSettingsProps['t']): string {
  return t(MODEL_CATALOG_STATE_KEYS[state])
}

function modelAvailabilityLabel(state: AntigravityModelAvailability, t: AntigravityAuthSettingsProps['t']): string {
  return t(MODEL_AVAILABILITY_KEYS[state])
}

function quotaStateLabel(state: QuotaStatusView['state'] | 'unknown', t: AntigravityAuthSettingsProps['t']): string {
  return t(QUOTA_STATE_KEYS[state])
}

function capabilityLabel(id: CapabilityRowId, t: AntigravityAuthSettingsProps['t']): string {
  return t(CAPABILITY_KEYS[id])
}

function stateLabel(state: CapabilityGateState, t: AntigravityAuthSettingsProps['t']): string {
  return t(CAPABILITY_STATE_KEYS[state])
}

function reasonLabel(reason: CapabilityGateReasonCode, t: AntigravityAuthSettingsProps['t']): string {
  return t(CAPABILITY_REASON_KEYS[reason])
}

function projectErrorText(errorCode: LoginErrorCode | undefined, t: AntigravityAuthSettingsProps['t']): string | undefined {
  if (errorCode === undefined) return undefined
  const key = PROJECT_ERROR_KEYS[errorCode]
  return key === undefined ? undefined : t(key)
}

function credentialStatusText(state: CredentialState, t: AntigravityAuthSettingsProps['t']): string {
  return t(CREDENTIAL_STATE_KEYS[state])
}

function revokeStatusText(state: RevokeState, t: AntigravityAuthSettingsProps['t']): string {
  return t(REVOKE_STATE_KEYS[state])
}

function loginStatusText(
  phase: AntigravityStatusView['login']['phase'] | undefined,
  acknowledged: boolean,
  t: AntigravityAuthSettingsProps['t'],
): string {
  if (!acknowledged) return t('loginRequiresAck')
  return t(phase === undefined ? 'loginReady' : LOGIN_PHASE_KEYS[phase])
}

function messageOf(_error: unknown, fallback: string): string {
  return fallback
}
