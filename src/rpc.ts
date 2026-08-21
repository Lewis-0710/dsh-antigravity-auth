/** Host dispatcher for the Antigravity OAuth loopback RPC channel. */

import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { OAuthFlowError } from './oauth-flow.ts'
import type { BootstrapStatusService } from './status.ts'

export { ANTIGRAVITY_AUTH_RPC_CHANNEL } from './rpc-contract.ts'

/** Dispatch closed, value-safe requests; callback URLs are never echoed. */
export async function handleAntigravityAuthRpc(
  service: Pick<BootstrapStatusService, 'status' | 'acknowledgeRisk' | 'startLogin' | 'cancelLogin' | 'completeCallback'>,
  endpoint: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<RpcResult<unknown>> {
  if (signal?.aborted === true) return cancelled()

  try {
    if (endpoint === 'status') {
      if (!isEmptyRecord(payload)) return badRequest('status expects an empty payload')
      return { ok: true, value: { status: await service.status() } }
    }
    if (endpoint === 'acknowledge-risk') {
      if (!isAcknowledgement(payload)) return badRequest('acknowledge-risk expects { acknowledge: true }')
      return { ok: true, value: await service.acknowledgeRisk() }
    }
    if (endpoint === 'login') {
      if (!isEmptyRecord(payload)) return badRequest('login expects an empty payload')
      return { ok: true, value: await service.startLogin() }
    }
    if (endpoint === 'cancel' || endpoint === 'cancel-login') {
      if (!isEmptyRecord(payload)) return badRequest('cancel expects an empty payload')
      return { ok: true, value: await service.cancelLogin() }
    }
    if (endpoint === 'complete-callback' || endpoint === 'complete-manual-callback') {
      if (!isCallbackPayload(payload)) return badRequest('complete-callback expects a callback URL')
      return { ok: true, value: await service.completeCallback(payload.callbackUrl) }
    }
    return badRequest('unknown Antigravity auth endpoint')
  } catch (error) {
    return safeFailure(error)
  }
}

function badRequest(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

function cancelled(): RpcResult<never> {
  return { ok: false, error: { code: 'cancelled', message: 'antigravity-auth: request cancelled', details: {} } }
}

function safeFailure(error: unknown): RpcResult<never> {
  const code = error instanceof OAuthFlowError ? error.code : 'internal'
  return {
    ok: false,
    error: {
      code: code as never,
      message: messageFor(code),
      details: {},
    },
  }
}

function messageFor(code: string): string {
  if (code === 'risk-acknowledgement-required') return 'Risk acknowledgement is required before login'
  if (code === 'port-conflict') return 'The fixed OAuth callback port is already in use'
  if (code === 'invalid-method') return 'The OAuth callback method is not accepted'
  if (code === 'invalid-path') return 'The OAuth callback path is not accepted'
  if (code === 'invalid-host') return 'The OAuth callback host is not accepted'
  if (code === 'duplicate-parameter') return 'The OAuth callback contains duplicate parameters'
  if (code === 'invalid-parameters') return 'The OAuth callback parameters are not accepted'
  if (code === 'missing-state') return 'The OAuth callback state is missing'
  if (code === 'state-mismatch') return 'The OAuth callback state was not accepted'
  if (code === 'missing-code') return 'The OAuth callback code is missing'
  if (code === 'oauth-error') return 'The OAuth provider rejected authorization'
  if (code === 'expired') return 'The OAuth login expired'
  if (code === 'cancelled') return 'The OAuth login was cancelled'
  if (code === 'no-pending-flow') return 'There is no pending OAuth login'
  if (code === 'project-unavailable') return 'No usable project is available for this account'
  if (code === 'project-validation-failed') return 'Project validation failed'
  if (code === 'credential-conflict') return 'The login changed while it was completing'
  if (code === 'persistence-failed') return 'The login could not be saved'
  if (code === 'token-exchange-failed') return 'The authorization code could not be exchanged'
  if (code === 'invalid-callback-url') return 'The callback URL is invalid'
  return 'antigravity-auth: operation failed'
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return isRecord(value) && Object.keys(value).length === 0
}

function isAcknowledgement(value: unknown): value is { acknowledge: true } {
  return isRecord(value)
    && Object.keys(value).length === 1
    && value.acknowledge === true
}

function isCallbackPayload(value: unknown): value is { callbackUrl: string } {
  return isRecord(value)
    && Object.keys(value).length === 1
    && typeof value.callbackUrl === 'string'
    && value.callbackUrl.length > 0
    && value.callbackUrl.length <= 4096
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
