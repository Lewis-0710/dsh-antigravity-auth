/** Settings shell for the value-free Antigravity bootstrap status. */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AntigravityAuthRpcClient } from '../rpc-contract.ts'
import type {
  AntigravityStatusView,
  CapabilityGateReasonCode,
  CapabilityGateState,
  CapabilityRowId,
} from '../status.ts'
import type { AntigravityAuthKey } from './locales.ts'

export interface AntigravityAuthSettingsProps {
  rpc: AntigravityAuthRpcClient
  t: (key: AntigravityAuthKey) => string
  subscribe: (listener: () => void) => () => void
}

type LoadState = 'loading' | 'ready' | 'error'

/** One navigable settings section; no credential or endpoint controls are rendered. */
export function AntigravityAuthSettings({ rpc, t, subscribe }: AntigravityAuthSettingsProps): ReactNode {
  const [status, setStatus] = useState<AntigravityStatusView | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [acknowledgeBusy, setAcknowledgeBusy] = useState(false)
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

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, resetTick])

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
        <button type="button" disabled={!acknowledged || status?.capabilities.some(capability => capability.id === 'auth-llm' && capability.state !== 'available')}>
          {t('loginUnavailable')}
        </button>
        <p role="status">{acknowledged ? t('loginPending') : t('loginRequiresAck')}</p>
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
    </section>
  )
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
  return reason === 'login-not-implemented' ? t('loginNotImplemented') : t('gateNotRun')
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback
}
