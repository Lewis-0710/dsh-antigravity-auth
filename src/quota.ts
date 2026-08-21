/** Single-account Antigravity quota normalization and bounded Host service. */

import {
  ANTIGRAVITY_WIRE_ORIGIN,
} from './wire-identity.ts'
import type { CredentialCoordinator, HostCredential } from './credential-coordinator.ts'
import {
  DEFAULT_PRIVATE_RESPONSE_BYTES,
  PrivateTransportError,
  createPrivateTransport,
  privateStatusError,
  readPrivateText,
  type PrivateTransport,
  type PrivateTransportOptions,
} from './private-transport.ts'

export const ANTIGRAVITY_QUOTA_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:retrieveUserQuotaSummary` as const
export const QUOTA_REFRESH_MIN_INTERVAL_MS = 30_000

export type QuotaState = 'available' | 'unauthenticated' | 'forbidden' | 'rate-limited' | 'offline' | 'timeout' | 'protocol-drift'
export type QuotaWindowKind = '5h' | 'weekly'

export interface QuotaWindowView {
  readonly window: QuotaWindowKind
  readonly remainingFraction: number
  readonly resetTime: string
}

export interface QuotaGroupView {
  readonly group: 'gemini' | 'non-gemini'
  readonly modelCount: number
  readonly windows: readonly QuotaWindowView[]
}

export interface QuotaStatusView {
  readonly state: QuotaState
  readonly checkedAt?: string
  readonly groups?: readonly QuotaGroupView[]
}

export interface QuotaService {
  refresh(signal?: AbortSignal, force?: boolean): Promise<QuotaStatusView>
  status(): QuotaStatusView
  dispose(): Promise<void>
}

export interface QuotaServiceOptions {
  readonly auth: Pick<CredentialCoordinator, 'credential'> | { credential(signal?: AbortSignal): Promise<HostCredential | undefined> }
  readonly transport?: PrivateTransport
  readonly transportOptions?: PrivateTransportOptions
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
  readonly minIntervalMs?: number
}

/** Normalize only validated, display-safe quota facts from a provider response. */
export function normalizeQuotaResponse(value: unknown, now = Date.now()): QuotaStatusView {
  const groups: QuotaGroupView[] = []
  const sourceValue = isRecord(value) && isRecord(value.response) ? value.response : value
  const source = isRecord(sourceValue) ? sourceValue : undefined
  const candidates = source === undefined ? [] : [
    ...(Array.isArray(source.groups) ? source.groups : []),
    ...(Array.isArray(source.buckets) ? source.buckets : []),
  ]
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    const buckets = Array.isArray(candidate.buckets) ? candidate.buckets : [candidate]
    for (const rawBucket of buckets) {
      if (!isRecord(rawBucket)) continue
      const window = identifyWindow(rawBucket)
      const resetTime = normalizeResetTime(rawBucket.resetTime ?? rawBucket.reset_time ?? rawBucket.resetAt, now)
      const fraction = normalizeFraction(rawBucket.remainingFraction ?? rawBucket.remaining_fraction ?? rawBucket.fraction ?? rawBucket.remaining)
      if (window === undefined || resetTime === undefined || fraction === undefined) continue
      const group = identifyGroup({ ...candidate, ...rawBucket })
      if (group === undefined) continue
      const modelCount = boundedCount(candidate.modelCount ?? candidate.model_count ?? candidate.models ?? descriptionModelCount(candidate.description))
      const existing = groups.find(item => item.group === group)
      if (existing === undefined) groups.push({ group, modelCount, windows: [{ window, remainingFraction: fraction, resetTime }] })
      else if (!existing.windows.some(item => item.window === window)) {
        const updated: QuotaGroupView = {
          group,
          modelCount: Math.max(existing.modelCount, modelCount),
          windows: [...existing.windows, { window, remainingFraction: fraction, resetTime }].sort(windowOrder),
        }
        groups.splice(groups.indexOf(existing), 1, updated)
      } else {
        const duplicate = existing.windows.find(item => item.window === window)
        if (duplicate !== undefined && (duplicate.remainingFraction !== fraction || duplicate.resetTime !== resetTime)) {
          throw new QuotaNormalizationError('The quota response contained conflicting windows')
        }
      }
    }
  }
  if (groups.length === 0) throw new QuotaNormalizationError('The quota response did not contain recognized windows')
  return { state: 'available', checkedAt: new Date(now).toISOString(), groups: groups.sort((left, right) => left.group.localeCompare(right.group)) }
}

export class QuotaNormalizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuotaNormalizationError'
  }
}

export function createQuotaService(options: QuotaServiceOptions): QuotaService {
  const now = options.now ?? (() => Date.now())
  const minInterval = positive(options.minIntervalMs, QUOTA_REFRESH_MIN_INTERVAL_MS)
  const transport = options.transport ?? createPrivateTransport({
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.transportOptions?.wireIdentity === undefined ? {} : { wireIdentity: options.transportOptions.wireIdentity }),
    ...(options.transportOptions?.responseHeaderTimeoutMs === undefined ? {} : { responseHeaderTimeoutMs: options.transportOptions.responseHeaderTimeoutMs }),
  })
  let current: QuotaStatusView = { state: 'unauthenticated' }
  let checkedAt = 0
  let inFlight: Promise<QuotaStatusView> | undefined
  let inFlightAbort: (() => void) | undefined
  const lifecycleController = new AbortController()
  let disposed = false

  return {
    refresh: async (signal, force = false) => {
      if (disposed) return current
      if (!force && checkedAt > 0 && now() - checkedAt < minInterval) return current
      if (inFlight !== undefined) return await waitForCaller(inFlight, signal)
      const combined = mergeAbortSignals(undefined, lifecycleController.signal)
      inFlightAbort = combined.dispose
      inFlight = refreshQuota(options.auth, transport, combined.signal, now).then(value => {
        current = value
        checkedAt = now()
        return value
      }).catch(error => {
        current = mapQuotaError(error, now())
        checkedAt = now()
        return current
      }).finally(() => { combined.dispose(); inFlightAbort = undefined; inFlight = undefined })
      return await waitForCaller(inFlight, signal)
    },
    status: () => current,
    dispose: async () => {
      disposed = true
      lifecycleController.abort()
      inFlightAbort?.()
      await inFlight?.catch(() => {})
    },
  }
}

async function refreshQuota(
  auth: QuotaServiceOptions['auth'],
  transport: PrivateTransport,
  signal: AbortSignal | undefined,
  now: () => number,
): Promise<QuotaStatusView> {
  const credential = await auth.credential(signal)
  if (credential === undefined) return { state: 'unauthenticated' }
  const response = await transport.request({
    url: ANTIGRAVITY_QUOTA_ENDPOINT,
    accessToken: credential.accessToken,
    body: JSON.stringify({ project: credential.projectId, request: {} }),
    ...(signal === undefined ? {} : { signal }),
  })
  const statusError = privateStatusError(response.status)
  if (statusError !== undefined) {
    await response.body?.cancel().catch(() => {})
    throw statusError
  }
  let value: unknown
  try {
    value = JSON.parse(await readPrivateText(response, { ...(signal === undefined ? {} : { signal }), maxBytes: DEFAULT_PRIVATE_RESPONSE_BYTES })) as unknown
  } catch (error) {
    if (error instanceof PrivateTransportError) throw error
    throw new QuotaNormalizationError('The quota response was not valid JSON')
  }
  return normalizeQuotaResponse(value, now())
}

function mapQuotaError(error: unknown, checkedAt: number): QuotaStatusView {
  const state: QuotaState = error instanceof PrivateTransportError
    ? error.code === 'authentication' ? 'unauthenticated'
      : error.code === 'forbidden' ? 'forbidden'
        : error.code === 'rate-limited' ? 'rate-limited'
          : error.code === 'timeout' ? 'timeout'
            : error.code === 'cancelled' ? 'offline'
              : error.code === 'protocol-drift' || error.code === 'invalid-response' ? 'protocol-drift'
                : 'offline'
    : error instanceof QuotaNormalizationError ? 'protocol-drift' : 'offline'
  return { state, checkedAt: new Date(checkedAt).toISOString() }
}

function identifyWindow(value: Record<string, unknown>): QuotaWindowKind | undefined {
  const raw = String(value.window ?? value.windowType ?? value.window_type ?? value.bucketId ?? value.bucket_id ?? '').toLowerCase()
  if (raw.includes('5h') || raw.includes('5-hour') || raw.includes('five')) return '5h'
  if (raw.includes('week') || raw.includes('weekly') || raw.includes('7d')) return 'weekly'
  const seconds = numberValue(value.durationSeconds ?? value.duration_seconds)
  if (seconds !== undefined) {
    if (seconds <= 5 * 60 * 60) return '5h'
    if (seconds <= 8 * 24 * 60 * 60) return 'weekly'
  }
  return undefined
}

function identifyGroup(value: Record<string, unknown>): 'gemini' | 'non-gemini' | undefined {
  const raw = String(value.group ?? value.quotaGroup ?? value.quota_group ?? value.modelFamily ?? value.displayName ?? value.bucketId ?? value.bucket_id ?? '').toLowerCase()
  if (raw.includes('non') || raw.includes('claude') || raw.includes('gpt')) return 'non-gemini'
  if (raw.includes('gemini')) return 'gemini'
  return undefined
}

function normalizeFraction(value: unknown): number | undefined {
  const number = numberValue(value)
  if (number === undefined) return undefined
  if (number >= 0 && number <= 1) return number
  if (number <= 100) return number / 100
  return undefined
}

function normalizeResetTime(value: unknown, now: number): string | undefined {
  const parsed = typeof value === 'number' ? value < 10_000_000_000 ? value * 1000 : value : typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000_000_000_000) return undefined
  const iso = new Date(parsed).toISOString()
  return Number.isFinite(Date.parse(iso)) && parsed >= now - 365 * 24 * 60 * 60 * 1000 ? iso : undefined
}

function boundedCount(value: unknown): number {
  if (Array.isArray(value)) return Math.min(value.length, 10_000)
  const number = numberValue(value)
  return number === undefined ? 0 : Math.min(Math.floor(number), 10_000)
}

function descriptionModelCount(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0 || value.length > 16 * 1024) return 0
  if (!/^[^:]{1,256}:\s*/u.test(value)) return 0
  const payload = value.replace(/^[^:]{1,256}:\s*/u, '')
  return Math.min(payload.split(',').map(item => item.trim()).filter(item => item.length > 0).length, 10_000)
}

function windowOrder(left: QuotaWindowView, right: QuotaWindowView): number {
  return left.window === right.window ? 0 : left.window === '5h' ? -1 : 1
}

function positive(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? fallback : Math.min(Math.floor(value), 24 * 60 * 60 * 1000)
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

async function waitForCaller<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return await promise
  if (signal.aborted) throw new PrivateTransportError('cancelled', 'The quota request was cancelled', { accepted: false })
  let remove: (() => void) | undefined
  const cancellation = new Promise<never>((_, reject) => {
    const abort = (): void => reject(new PrivateTransportError('cancelled', 'The quota request was cancelled', { accepted: false }))
    remove = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    return await Promise.race([promise, cancellation])
  } finally {
    remove?.()
  }
}

function mergeAbortSignals(first: AbortSignal | undefined, second: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const abort = (event: Event): void => { if (!controller.signal.aborted) controller.abort((event.target as AbortSignal).reason) }
  const signals = first === undefined ? [second] : [first, second]
  for (const signal of signals) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', abort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => { for (const signal of signals) signal.removeEventListener('abort', abort) },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
