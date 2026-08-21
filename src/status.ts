/** Value-free login and capability status shared by Host and browser code. */

import type { LoginActionResult, LoginCompletionResult, LoginErrorCode, LoginPhase, LoginStartResult, LoginStatusView } from './login-types.ts'

export const ANTIGRAVITY_PLUGIN_ID = 'dsh-antigravity-auth' as const
export const CAPABILITY_ROW_IDS = ['auth-llm', 'search', 'image', 'video'] as const

export type CapabilityRowId = (typeof CAPABILITY_ROW_IDS)[number]
export type CapabilityGateState = 'available' | 'disabled' | 'poc-pending' | 'protocol-drift'
export type CapabilityGateReasonCode = 'login-not-implemented' | 'gate-not-run'
export type { LoginActionResult, LoginErrorCode, LoginPhase, LoginStartResult, LoginStatusView }

export interface CapabilityGateStatus {
  readonly id: CapabilityRowId
  readonly state: CapabilityGateState
  readonly reasonCode: CapabilityGateReasonCode
}

export interface AntigravityStatusView {
  readonly pluginId: typeof ANTIGRAVITY_PLUGIN_ID
  readonly phase: 'bootstrap'
  readonly privateSelfUse: true
  readonly singleAccount: true
  readonly riskAcknowledgementRequired: true
  readonly riskAcknowledged: boolean
  readonly login: LoginStatusView
  readonly capabilities: readonly CapabilityGateStatus[]
}

export interface RiskAcknowledgementResult {
  readonly acknowledged: true
}

export interface BootstrapStatusService {
  status(): Promise<AntigravityStatusView>
  acknowledgeRisk(): Promise<RiskAcknowledgementResult>
  startLogin(): Promise<LoginStartResult>
  completeCallback(callbackUrl: string): Promise<LoginCompletionResult>
  cancelLogin(): Promise<{ readonly phase: LoginPhase; readonly errorCode?: LoginErrorCode }>
  dispose(): Promise<void>
}

const CAPABILITY_DEFINITIONS: readonly CapabilityGateStatus[] = Object.freeze([
  Object.freeze({ id: 'auth-llm', state: 'poc-pending', reasonCode: 'login-not-implemented' }),
  Object.freeze({ id: 'search', state: 'poc-pending', reasonCode: 'gate-not-run' }),
  Object.freeze({ id: 'image', state: 'poc-pending', reasonCode: 'gate-not-run' }),
  Object.freeze({ id: 'video', state: 'poc-pending', reasonCode: 'gate-not-run' }),
])

export function createStatusView(
  riskAcknowledged: boolean,
  login: LoginStatusView,
): AntigravityStatusView {
  return Object.freeze({
    pluginId: ANTIGRAVITY_PLUGIN_ID,
    phase: 'bootstrap',
    privateSelfUse: true,
    singleAccount: true,
    riskAcknowledgementRequired: true,
    riskAcknowledged,
    login: Object.freeze({ ...login }),
    capabilities: Object.freeze(CAPABILITY_DEFINITIONS.map(capability => Object.freeze({ ...capability }))),
  })
}
