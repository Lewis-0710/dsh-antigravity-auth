/** Browser-safe login state shared by the Host OAuth flow and settings RPC. */

export type LoginPhase = 'idle' | 'pending' | 'success' | 'cancelled' | 'expired' | 'port-conflict' | 'failed'

export type LoginErrorCode =
  | 'invalid-method'
  | 'invalid-path'
  | 'invalid-host'
  | 'duplicate-parameter'
  | 'invalid-parameters'
  | 'missing-state'
  | 'state-mismatch'
  | 'missing-code'
  | 'oauth-error'
  | 'no-pending-flow'
  | 'expired'
  | 'cancelled'
  | 'port-conflict'
  | 'token-exchange-failed'
  | 'project-unavailable'
  | 'project-authentication-failed'
  | 'project-forbidden'
  | 'project-rate-limited'
  | 'project-offline'
  | 'project-malformed'
  | 'project-protocol-drift'
  | 'project-validation-failed'
  | 'persistence-failed'
  | 'credential-conflict'
  | 'invalid-callback-url'
  | 'risk-acknowledgement-required'
  | 'internal'

export interface LoginStatusView {
  readonly phase: LoginPhase
  readonly configured: boolean
  readonly projectAvailable: boolean
  readonly authorizationUrl?: string
  readonly expiresAt?: string
  readonly maskedEmail?: string
  readonly errorCode?: LoginErrorCode
}

export interface LoginStartResult {
  readonly started: true
  readonly phase: 'pending'
  readonly authorizationUrl: string
  readonly expiresAt: string
}

export interface LoginActionResult {
  readonly phase: LoginPhase
  readonly errorCode?: LoginErrorCode
}

export type LoginCompletionResult =
  | { readonly completed: true; readonly phase: 'success' }
  | { readonly completed: false; readonly phase: 'failed' | 'cancelled'; readonly errorCode: LoginErrorCode }

export type { LoginStatusView as AntigravityLoginStatusView }
