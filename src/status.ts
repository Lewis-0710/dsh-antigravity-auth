/** Value-free login and capability status shared by Host and browser code. */

import type { LoginActionResult, LoginCompletionResult, LoginErrorCode, LoginPhase, LoginStartResult, LoginStatusView } from './login-types.ts'
import type { CredentialStatusView, LogoutResult, RevokeActionResult, RevokeStatusView } from './credential-coordinator.ts'

export const ANTIGRAVITY_PLUGIN_ID = 'dsh-antigravity-auth' as const
export const CAPABILITY_ROW_IDS = ['auth-llm', 'search', 'image', 'video'] as const

export type CapabilityRowId = (typeof CAPABILITY_ROW_IDS)[number]
export type CapabilityGateState = 'available' | 'disabled' | 'poc-pending' | 'protocol-drift'
export type CapabilityGateReasonCode = 'login-not-implemented' | 'llm-not-implemented' | 'gate-not-run'
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
  /** Credential state is value-safe; tokens and grant errors never cross this boundary. */
  readonly credential?: CredentialStatusView
  readonly revoke?: RevokeStatusView
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
  logout(): Promise<LogoutResult>
  revoke(confirmed: boolean, signal?: AbortSignal): Promise<RevokeActionResult>
  dispose(): Promise<void>
}

const CAPABILITY_DEFINITIONS: readonly CapabilityGateStatus[] = Object.freeze([
  Object.freeze({ id: 'auth-llm', state: 'poc-pending', reasonCode: 'llm-not-implemented' }),
  Object.freeze({ id: 'search', state: 'poc-pending', reasonCode: 'gate-not-run' }),
  Object.freeze({ id: 'image', state: 'poc-pending', reasonCode: 'gate-not-run' }),
  Object.freeze({ id: 'video', state: 'poc-pending', reasonCode: 'gate-not-run' }),
])

export function createStatusView(
  riskAcknowledged: boolean,
  login: LoginStatusView,
  credential?: CredentialStatusView,
  revoke?: RevokeStatusView,
): AntigravityStatusView {
  return Object.freeze({
    pluginId: ANTIGRAVITY_PLUGIN_ID,
    phase: 'bootstrap',
    privateSelfUse: true,
    singleAccount: true,
    riskAcknowledgementRequired: true,
    riskAcknowledged,
    login: Object.freeze({ ...login }),
    ...(credential === undefined ? {} : { credential: Object.freeze({ ...credential }) }),
    ...(revoke === undefined ? {} : { revoke: Object.freeze({ ...revoke }) }),
    capabilities: Object.freeze(CAPABILITY_DEFINITIONS.map(capability => Object.freeze({ ...capability }))),
  })
}
