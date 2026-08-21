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

export const ANTIGRAVITY_AUTH_RPC_CHANNEL = '/antigravity-auth' as const

export interface AntigravityAuthRpcClient {
  status(signal?: AbortSignal): Promise<RpcResult<{ status: AntigravityStatusView }>>
  acknowledgeRisk(signal?: AbortSignal): Promise<RpcResult<RiskAcknowledgementResult>>
  login(signal?: AbortSignal): Promise<RpcResult<LoginStartResult>>
  cancelLogin(signal?: AbortSignal): Promise<RpcResult<LoginActionResult>>
  completeCallback(callbackUrl: string, signal?: AbortSignal): Promise<RpcResult<OAuthFlowCompletionResult>>
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
  }
}

/** Parse the closed status envelope received by the browser. */
export function parseStatusResult(value: unknown): AntigravityStatusView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ['status'])) return undefined
  return parseStatus(value.status)
}

function parseStatus(value: unknown): AntigravityStatusView | undefined {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'pluginId',
      'phase',
      'privateSelfUse',
      'singleAccount',
      'riskAcknowledgementRequired',
      'riskAcknowledged',
      'login',
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
    capabilities,
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
    || value === 'project-validation-failed'
    || value === 'persistence-failed'
    || value === 'credential-conflict'
    || value === 'invalid-callback-url'
    || value === 'risk-acknowledgement-required'
    || value === 'internal'
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
  return value === 'login-not-implemented' || value === 'gate-not-run'
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
