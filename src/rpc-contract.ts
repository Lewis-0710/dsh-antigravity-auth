/** Browser-safe, value-free RPC contract for the bootstrap shell. */

import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { CAPABILITY_ROW_IDS } from './status.ts'
import type {
  AntigravityStatusView,
  CapabilityGateReasonCode,
  CapabilityGateState,
  CapabilityRowId,
  LoginStartResult,
  RiskAcknowledgementResult,
} from './status.ts'

export const ANTIGRAVITY_AUTH_RPC_CHANNEL = '/antigravity-auth' as const

export interface AntigravityAuthRpcClient {
  status(signal?: AbortSignal): Promise<RpcResult<{ status: AntigravityStatusView }>>
  acknowledgeRisk(signal?: AbortSignal): Promise<RpcResult<RiskAcknowledgementResult>>
  login(signal?: AbortSignal): Promise<RpcResult<LoginStartResult>>
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
    status: async (signal) => {
      const result = await rpc.call(ANTIGRAVITY_AUTH_RPC_CHANNEL, 'status', {}, signal)
      if (!result.ok) return result
      const status = parseStatusResult(result.value)
      return status === undefined ? invalidResponse('status') : { ok: true, value: { status } }
    },
    acknowledgeRisk: async (signal) => {
      const result = await rpc.call(
        ANTIGRAVITY_AUTH_RPC_CHANNEL,
        'acknowledge-risk',
        { acknowledge: true },
        signal,
      )
      if (!result.ok) return result
      const acknowledgement = parseAcknowledgementResult(result.value)
      return acknowledgement === undefined
        ? invalidResponse('acknowledge-risk')
        : { ok: true, value: acknowledgement }
    },
    login: async (signal) => {
      const result = await rpc.call(ANTIGRAVITY_AUTH_RPC_CHANNEL, 'login', {}, signal)
      if (!result.ok) return result
      const login = parseLoginResult(result.value)
      return login === undefined ? invalidResponse('login') : { ok: true, value: login }
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
      'capabilities',
    ])
    || value.pluginId !== 'dsh-antigravity-auth'
    || value.phase !== 'bootstrap'
    || value.privateSelfUse !== true
    || value.singleAccount !== true
    || value.riskAcknowledgementRequired !== true
    || typeof value.riskAcknowledged !== 'boolean'
    || !Array.isArray(value.capabilities)
    || value.capabilities.length !== CAPABILITY_ROW_IDS.length) return undefined

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
    capabilities,
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
    && hasExactKeys(value, ['started', 'reason'])
    && value.started === false
    && value.reason === 'poc-pending'
    ? { started: false, reason: 'poc-pending' }
    : undefined
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
