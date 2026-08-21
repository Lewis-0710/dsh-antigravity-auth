/** Browser-safe, value-free RPC contract for the Antigravity login flow. */

import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { CAPABILITY_ROW_IDS } from './status.ts'
import type {
  AntigravityStatusView,
  CapabilityGateReasonCode,
  CapabilityGateState,
  CapabilityRowId,
  LoginActionResult,
  LoginErrorCode,
  LoginPhase,
  LoginStartResult,
  LoginStatusView,
  RiskAcknowledgementResult,
} from './status.ts'
import type { OAuthFlowCompletionResult } from './oauth-flow.ts'
import type { CredentialErrorCode, CredentialState, CredentialStatusView, RevokeActionResult, RevokeErrorCode, RevokeState, RevokeStatusView } from './credential-coordinator.ts'
import type { QuotaGroupView, QuotaState, QuotaStatusView, QuotaWindowKind } from './quota.ts'

export const ANTIGRAVITY_AUTH_RPC_CHANNEL = '/antigravity-auth' as const

export interface AntigravityAuthRpcClient {
  status(signal?: AbortSignal): Promise<RpcResult<{ status: AntigravityStatusView }>>
  acknowledgeRisk(signal?: AbortSignal): Promise<RpcResult<RiskAcknowledgementResult>>
  login(signal?: AbortSignal): Promise<RpcResult<LoginStartResult>>
  cancelLogin(signal?: AbortSignal): Promise<RpcResult<LoginActionResult>>
  logout(signal?: AbortSignal): Promise<RpcResult<{ state: 'logged-out' }>>
  revoke(signal?: AbortSignal): Promise<RpcResult<RevokeActionResult>>
  completeCallback(callbackUrl: string, signal?: AbortSignal): Promise<RpcResult<OAuthFlowCompletionResult>>
  usage?(signal?: AbortSignal, force?: boolean): Promise<RpcResult<QuotaStatusView>>
}

export interface AntigravityAuthConnectionRpc {
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<RpcResult<unknown>>
}

/** Build the browser face over the plugin-owned loopback channel. */
export function createAntigravityAuthRpcClient(rpc: AntigravityAuthConnectionRpc): AntigravityAuthRpcClient {
  return {
    status: async signal => {
      const result = await rpc.call(ANTIGRAVITY_AUTH_RPC_CHANNEL, 'status', {}, signal)
      if (!result.ok) return result
      const status = parseStatusResult(result.value)
      return status === undefined ? invalidResponse('status') : { ok: true, value: { status } }
    },
    acknowledgeRisk: async signal => {
      const result = await rpc.call(ANTIGRAVITY_AUTH_RPC_CHANNEL, 'acknowledge-risk', { acknowledge: true }, signal)
      if (!result.ok) return result
      const acknowledgement = parseAcknowledgementResult(result.value)
      return acknowledgement === undefined
        ? invalidResponse('acknowledge-risk')
        : { ok: true, value: acknowledgement }
    },
    login: async signal => {
      const result = await rpc.call(ANTIGRAVITY_AUTH_RPC_CHANNEL, 'login', {}, signal)
      if (!result.ok) return result
      const login = parseLoginResult(result.value)
      return login === undefined ? invalidResponse('login') : { ok: true, value: login }
    },
    cancelLogin: async signal => {
      const result = await rpc.call(ANTIGRAVITY_AUTH_RPC_CHANNEL, 'cancel', {}, signal)
      if (!result.ok) return result
      const cancellation = parseActionResult(result.value)
      return cancellation === undefined ? invalidResponse('cancel') : { ok: true, value: cancellation }
    },
    logout: async signal => {
      const result = await rpc.call(ANTIGRAVITY_AUTH_RPC_CHANNEL, 'logout', {}, signal)
      if (!result.ok) return result
      return parseLogoutResult(result.value) === undefined ? invalidResponse('logout') : { ok: true, value: { state: 'logged-out' } }
    },
    revoke: async signal => {
      const result = await rpc.call(ANTIGRAVITY_AUTH_RPC_CHANNEL, 'revoke', { confirmed: true }, signal)
      if (!result.ok) return result
      const revocation = parseRevokeResult(result.value)
      return revocation === undefined ? invalidResponse('revoke') : { ok: true, value: revocation }
    },
    completeCallback: async (callbackUrl, signal) => {
      const result = await rpc.call(
        ANTIGRAVITY_AUTH_RPC_CHANNEL,
        'complete-callback',
        { callbackUrl },
        signal,
      )
      if (!result.ok) return result
      const completion = parseCompletionResult(result.value)
      return completion === undefined ? invalidResponse('complete-callback') : { ok: true, value: completion }
    },
    usage: async (signal, force = false) => {
      const result = await rpc.call(ANTIGRAVITY_AUTH_RPC_CHANNEL, 'usage', { force }, signal)
      if (!result.ok) return result
      const usage = parseUsageResult(result.value)
      return usage === undefined ? invalidResponse('usage') : { ok: true, value: usage }
    },
  }
}

/** Parse a value-safe, normalized quota envelope received by the browser. */
export function parseUsageResult(value: unknown): QuotaStatusView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ['state', ...(value.checkedAt === undefined ? [] : ['checkedAt']), ...(value.groups === undefined ? [] : ['groups'])])) return undefined
  if (!isQuotaState(value.state)) return undefined
  if (value.checkedAt !== undefined && !isIsoTime(value.checkedAt)) return undefined
  if (value.state === 'available' && value.groups === undefined) return undefined
  if (value.groups !== undefined) {
    if (!Array.isArray(value.groups) || value.groups.length === 0) return undefined
    const groups: QuotaGroupView[] = []
    for (const rawGroup of value.groups) {
      if (!isRecord(rawGroup) || !hasExactKeys(rawGroup, ['group', 'modelCount', 'windows']) || (rawGroup.group !== 'gemini' && rawGroup.group !== 'non-gemini') || !Number.isSafeInteger(rawGroup.modelCount) || (rawGroup.modelCount as number) < 0 || !Array.isArray(rawGroup.windows)) return undefined
      const modelCount = rawGroup.modelCount as number
      if (rawGroup.windows.length === 0) return undefined
      const windows: Array<{ window: QuotaWindowKind; remainingFraction: number; resetTime: string }> = []
      for (const rawWindow of rawGroup.windows) {
        if (!isRecord(rawWindow) || !hasExactKeys(rawWindow, ['window', 'remainingFraction', 'resetTime']) || (rawWindow.window !== '5h' && rawWindow.window !== 'weekly') || typeof rawWindow.remainingFraction !== 'number' || !Number.isFinite(rawWindow.remainingFraction) || rawWindow.remainingFraction < 0 || rawWindow.remainingFraction > 1 || !isIsoTime(rawWindow.resetTime)) return undefined
        windows.push({ window: rawWindow.window, remainingFraction: rawWindow.remainingFraction, resetTime: rawWindow.resetTime })
      }
      groups.push({ group: rawGroup.group, modelCount, windows })
    }
    return { state: value.state, ...(typeof value.checkedAt === 'string' ? { checkedAt: value.checkedAt } : {}), groups }
  }
  return { state: value.state, ...(typeof value.checkedAt === 'string' ? { checkedAt: value.checkedAt } : {}) }
}

/** Parse the closed status envelope received by the browser. */
export function parseStatusResult(value: unknown): AntigravityStatusView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ['status'])) return undefined
  return parseStatus(value.status)
}

function parseStatus(value: unknown): AntigravityStatusView | undefined {
  if (!isRecord(value)
    || !hasAllowedKeys(value, [
      'pluginId',
      'phase',
      'privateSelfUse',
      'singleAccount',
      'riskAcknowledgementRequired',
      'riskAcknowledged',
      'login',
      'credential',
      'revoke',
      'capabilities',
    ])
    || value.pluginId !== 'dsh-antigravity-auth'
    || value.phase !== 'bootstrap'
    || value.privateSelfUse !== true
    || value.singleAccount !== true
    || value.riskAcknowledgementRequired !== true
    || typeof value.riskAcknowledged !== 'boolean'
    || !Array.isArray(value.capabilities)) return undefined

  const login = parseLoginStatus(value.login)
  if (login === undefined) return undefined
  const credential = value.credential === undefined ? undefined : parseCredentialStatus(value.credential)
  if (value.credential !== undefined && credential === undefined) return undefined
  const revoke = value.revoke === undefined ? undefined : parseRevokeStatus(value.revoke)
  if (value.revoke !== undefined && revoke === undefined) return undefined
  const seen = new Set<string>()
  const capabilities: CapabilityGateStatus[] = []
  for (const capability of value.capabilities) {
    const parsed = parseCapability(capability)
    if (parsed === undefined || seen.has(parsed.id)) return undefined
    seen.add(parsed.id)
    capabilities.push(parsed)
  }
  if (seen.size !== CAPABILITY_ROW_IDS.length || CAPABILITY_ROW_IDS.some(id => !seen.has(id))) return undefined

  return {
    pluginId: 'dsh-antigravity-auth',
    phase: 'bootstrap',
    privateSelfUse: true,
    singleAccount: true,
    riskAcknowledgementRequired: true,
    riskAcknowledged: value.riskAcknowledged,
    login,
    ...(credential === undefined ? {} : { credential }),
    ...(revoke === undefined ? {} : { revoke }),
    capabilities,
  }
}

function parseCredentialStatus(value: unknown): CredentialStatusView | undefined {
  if (!isRecord(value)
    || typeof value.state !== 'string'
    || !isCredentialState(value.state)
    || typeof value.configured !== 'boolean'
    || !hasAllowedKeys(value, ['state', 'configured', 'expiresAt', 'lastRefreshAt', 'errorCode'])) return undefined
  if (value.expiresAt !== undefined && (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)))) return undefined
  if (value.lastRefreshAt !== undefined && (typeof value.lastRefreshAt !== 'string' || !Number.isFinite(Date.parse(value.lastRefreshAt)))) return undefined
  if (value.errorCode !== undefined && (typeof value.errorCode !== 'string' || !isCredentialErrorCode(value.errorCode))) return undefined
  return {
    state: value.state,
    configured: value.configured,
    ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}),
    ...(typeof value.lastRefreshAt === 'string' ? { lastRefreshAt: value.lastRefreshAt } : {}),
    ...(typeof value.errorCode === 'string' ? { errorCode: value.errorCode } : {}),
  }
}

function parseRevokeStatus(value: unknown): RevokeStatusView | undefined {
  if (!isRecord(value)
    || typeof value.state !== 'string'
    || !isRevokeState(value.state)
    || !hasAllowedKeys(value, ['state', 'errorCode'])) return undefined
  if (value.errorCode !== undefined && (typeof value.errorCode !== 'string' || !isRevokeErrorCode(value.errorCode))) return undefined
  return {
    state: value.state,
    ...(typeof value.errorCode === 'string' ? { errorCode: value.errorCode } : {}),
  }
}

function parseLoginStatus(value: unknown): LoginStatusView | undefined {
  if (!isRecord(value)
    || typeof value.phase !== 'string'
    || !isLoginPhase(value.phase)
    || typeof value.configured !== 'boolean'
    || typeof value.projectAvailable !== 'boolean') return undefined
  const allowed = ['phase', 'configured', 'projectAvailable', 'authorizationUrl', 'expiresAt', 'maskedEmail', 'errorCode']
  if (Object.keys(value).some(key => !allowed.includes(key))) return undefined
  if (value.authorizationUrl !== undefined && !isSafeAuthorizationUrl(value.authorizationUrl)) return undefined
  if (value.expiresAt !== undefined && (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)))) return undefined
  if (value.maskedEmail !== undefined && (typeof value.maskedEmail !== 'string' || !isMaskedEmail(value.maskedEmail))) return undefined
  if (value.errorCode !== undefined && !isLoginErrorCode(value.errorCode)) return undefined
  if (isErrorPhase(value.phase)
    ? typeof value.errorCode !== 'string'
    : value.errorCode !== undefined) return undefined
  if (value.phase === 'pending'
    ? typeof value.authorizationUrl !== 'string' || typeof value.expiresAt !== 'string'
    : value.authorizationUrl !== undefined) return undefined
  return {
    phase: value.phase,
    configured: value.configured,
    projectAvailable: value.projectAvailable,
    ...(typeof value.authorizationUrl === 'string' ? { authorizationUrl: value.authorizationUrl } : {}),
    ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}),
    ...(typeof value.maskedEmail === 'string' ? { maskedEmail: value.maskedEmail } : {}),
    ...(typeof value.errorCode === 'string' ? { errorCode: value.errorCode } : {}),
  }
}

function parseCapability(value: unknown): CapabilityGateStatus | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'state', 'reasonCode'])) return undefined
  if (!isCapabilityRowId(value.id) || !isCapabilityGateState(value.state) || !isCapabilityReasonCode(value.reasonCode)) {
    return undefined
  }
  return { id: value.id, state: value.state, reasonCode: value.reasonCode }
}

function parseAcknowledgementResult(value: unknown): RiskAcknowledgementResult | undefined {
  return isRecord(value) && hasExactKeys(value, ['acknowledged']) && value.acknowledged === true
    ? { acknowledged: true }
    : undefined
}

function parseLoginResult(value: unknown): LoginStartResult | undefined {
  return isRecord(value)
    && hasExactKeys(value, ['started', 'phase', 'authorizationUrl', 'expiresAt'])
    && value.started === true
    && value.phase === 'pending'
    && isSafeAuthorizationUrl(value.authorizationUrl)
    && typeof value.expiresAt === 'string'
    && Number.isFinite(Date.parse(value.expiresAt))
    ? {
        started: true,
        phase: 'pending',
        authorizationUrl: value.authorizationUrl,
        expiresAt: value.expiresAt,
      }
    : undefined
}

function parseActionResult(value: unknown): LoginActionResult | undefined {
  if (!isRecord(value) || typeof value.phase !== 'string' || !isLoginPhase(value.phase)) return undefined
  if (Object.keys(value).some(key => key !== 'phase' && key !== 'errorCode')) return undefined
  if (value.errorCode !== undefined && !isLoginErrorCode(value.errorCode)) return undefined
  return {
    phase: value.phase,
    ...(typeof value.errorCode === 'string' ? { errorCode: value.errorCode } : {}),
  }
}

function parseLogoutResult(value: unknown): { readonly state: 'logged-out' } | undefined {
  return isRecord(value) && hasExactKeys(value, ['state']) && value.state === 'logged-out'
    ? { state: 'logged-out' }
    : undefined
}

function parseRevokeResult(value: unknown): RevokeActionResult | undefined {
  if (!isRecord(value) || typeof value.state !== 'string') return undefined
  if (value.state === 'confirmation-required' || value.state === 'revoked' || value.state === 'logged-out' || value.state === 'superseded') {
    return hasExactKeys(value, ['state']) ? { state: value.state } : undefined
  }
  if (value.state === 'failed'
    && hasExactKeys(value, ['state', 'errorCode'])
    && typeof value.errorCode === 'string'
    && isRevokeErrorCode(value.errorCode)) {
    return { state: 'failed', errorCode: value.errorCode }
  }
  return undefined
}

function parseCompletionResult(value: unknown): OAuthFlowCompletionResult | undefined {
  if (!isRecord(value) || typeof value.completed !== 'boolean' || typeof value.phase !== 'string') return undefined
  if (value.completed === true && value.phase === 'success' && hasExactKeys(value, ['completed', 'phase'])) {
    return { completed: true, phase: 'success' }
  }
  if (value.completed === false
    && (value.phase === 'failed' || value.phase === 'cancelled')
    && isLoginErrorCode(value.errorCode)
    && hasExactKeys(value, ['completed', 'phase', 'errorCode'])) {
    return { completed: false, phase: value.phase, errorCode: value.errorCode }
  }
  return undefined
}

function isSafeAuthorizationUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) return false
  try {
    const parsed = new URL(value)
    const state = parsed.searchParams.get('state')
    return parsed.protocol === 'https:'
      && parsed.hostname === 'accounts.google.com'
      && parsed.pathname === '/o/oauth2/v2/auth'
      && parsed.hash.length === 0
      && parsed.searchParams.getAll('state').length === 1
      && typeof state === 'string'
      && /^[A-Za-z0-9_-]{43}$/u.test(state)
      && parsed.searchParams.get('code_verifier') === null
  } catch {
    return false
  }
}

function isMaskedEmail(value: string): boolean {
  return value.length <= 256 && /^.[*]{3}[^@]*@[^@\s]+$/u.test(value)
}

function isErrorPhase(value: LoginPhase): boolean {
  return value === 'cancelled' || value === 'expired' || value === 'port-conflict' || value === 'failed'
}

function isLoginPhase(value: unknown): value is LoginPhase {
  return value === 'idle'
    || value === 'pending'
    || value === 'success'
    || value === 'cancelled'
    || value === 'expired'
    || value === 'port-conflict'
    || value === 'failed'
}

function isLoginErrorCode(value: unknown): value is LoginErrorCode {
  return value === 'invalid-method'
    || value === 'invalid-path'
    || value === 'invalid-host'
    || value === 'duplicate-parameter'
    || value === 'invalid-parameters'
    || value === 'missing-state'
    || value === 'state-mismatch'
    || value === 'missing-code'
    || value === 'oauth-error'
    || value === 'no-pending-flow'
    || value === 'expired'
    || value === 'cancelled'
    || value === 'port-conflict'
    || value === 'token-exchange-failed'
    || value === 'project-unavailable'
    || value === 'project-authentication-failed'
    || value === 'project-forbidden'
    || value === 'project-rate-limited'
    || value === 'project-offline'
    || value === 'project-malformed'
    || value === 'project-protocol-drift'
    || value === 'project-validation-failed'
    || value === 'persistence-failed'
    || value === 'credential-conflict'
    || value === 'invalid-callback-url'
    || value === 'risk-acknowledgement-required'
    || value === 'internal'
}

function isQuotaState(value: unknown): value is QuotaState {
  return value === 'available' || value === 'unauthenticated' || value === 'forbidden' || value === 'rate-limited' || value === 'offline' || value === 'timeout' || value === 'protocol-drift'
}

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))
}

function isCapabilityRowId(value: unknown): value is CapabilityRowId {
  return typeof value === 'string' && CAPABILITY_ROW_IDS.includes(value as CapabilityRowId)
}

function isCapabilityGateState(value: unknown): value is CapabilityGateState {
  return value === 'available'
    || value === 'disabled'
    || value === 'poc-pending'
    || value === 'protocol-drift'
}

function isCapabilityReasonCode(value: unknown): value is CapabilityGateReasonCode {
  return value === 'login-not-implemented'
    || value === 'llm-not-implemented'
    || value === 'gate-not-run'
    || value === 'project-unavailable'
    || value === 'capability-ready'
}

function isCredentialState(value: unknown): value is CredentialState {
  return value === 'logged-out'
    || value === 'logged-in'
    || value === 'refreshing'
    || value === 'refresh-failed'
    || value === 're-login-required'
}

function isCredentialErrorCode(value: unknown): value is CredentialErrorCode {
  return value === 'invalid-grant'
    || value === 'network'
    || value === 'timeout'
    || value === 'rate-limited'
    || value === 'server-error'
    || value === 'http-error'
    || value === 'invalid-response'
    || value === 'conflict'
    || value === 'storage'
    || value === 'cancelled'
}

function isRevokeState(value: unknown): value is RevokeState {
  return value === 'idle'
    || value === 'pending'
    || value === 'confirmation-required'
    || value === 'revoked'
    || value === 'logged-out'
    || value === 'failed'
    || value === 'superseded'
}

function isRevokeErrorCode(value: unknown): value is RevokeErrorCode {
  return value === 'network'
    || value === 'timeout'
    || value === 'rate-limited'
    || value === 'server-error'
    || value === 'http-error'
    || value === 'invalid-response'
    || value === 'storage'
}

function hasAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index])
}

function invalidResponse(endpoint: string): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: `antigravity-auth: invalid ${endpoint} response from Host`,
      details: {},
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type CapabilityGateStatus = AntigravityStatusView['capabilities'][number]
