/** Value-free bootstrap status owned by the Host half of the plugin. */

export const ANTIGRAVITY_PLUGIN_ID = 'dsh-antigravity-auth' as const
export const CAPABILITY_ROW_IDS = ['auth-llm', 'search', 'image', 'video'] as const

export type CapabilityRowId = (typeof CAPABILITY_ROW_IDS)[number]
export type CapabilityGateState = 'available' | 'disabled' | 'poc-pending' | 'protocol-drift'
export type CapabilityGateReasonCode = 'login-not-implemented' | 'gate-not-run'

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
  readonly capabilities: readonly CapabilityGateStatus[]
}

export interface RiskAcknowledgementResult {
  readonly acknowledged: true
}

export interface LoginStartResult {
  readonly started: false
  readonly reason: 'poc-pending'
}

export interface BootstrapStatusService {
  status(): AntigravityStatusView
  acknowledgeRisk(): RiskAcknowledgementResult
  beginLogin(): LoginStartResult | undefined
}

const CAPABILITY_DEFINITIONS: readonly CapabilityGateStatus[] = Object.freeze([
  Object.freeze({ id: 'auth-llm', state: 'poc-pending', reasonCode: 'login-not-implemented' }),
  Object.freeze({ id: 'search', state: 'poc-pending', reasonCode: 'gate-not-run' }),
  Object.freeze({ id: 'image', state: 'poc-pending', reasonCode: 'gate-not-run' }),
  Object.freeze({ id: 'video', state: 'poc-pending', reasonCode: 'gate-not-run' }),
])

/** Create one process-local status service; no credential or network state is read. */
export function createBootstrapStatusService(): BootstrapStatusService {
  let riskAcknowledged = false

  return {
    status: () => createStatus(riskAcknowledged),
    acknowledgeRisk: () => {
      riskAcknowledged = true
      return { acknowledged: true }
    },
    beginLogin: () => riskAcknowledged ? { started: false, reason: 'poc-pending' } : undefined,
  }
}

function createStatus(riskAcknowledged: boolean): AntigravityStatusView {
  return Object.freeze({
    pluginId: ANTIGRAVITY_PLUGIN_ID,
    phase: 'bootstrap',
    privateSelfUse: true,
    singleAccount: true,
    riskAcknowledgementRequired: true,
    riskAcknowledged,
    capabilities: Object.freeze(CAPABILITY_DEFINITIONS.map(capability => Object.freeze({ ...capability }))),
  })
}
