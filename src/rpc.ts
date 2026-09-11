/** Host dispatcher protected by the Antigravity account RPC activation guard. */

import type { ConnectionRpcResult as RpcResult } from '@deepseek-ai/dsh-client-connection'
import { OAuthFlowError } from './oauth-flow.ts'
import { CredentialOperationError, credentialErrorMessage } from './credential-coordinator.ts'
import type { BootstrapStatusService } from './status.ts'
import type { QuotaStatusView } from './quota.ts'
import { isSafeRpcErrorCode, safeRpcErrorMessage } from './rpc-vocabulary.ts'
import type { AntigravityModelCatalogService } from './model-catalog.ts'
import { isBoundedSafeText } from './safe-text.ts'

export { ANTIGRAVITY_AUTH_RPC_CHANNEL, ANTIGRAVITY_AUTH_RPC_NAMESPACE } from './rpc-contract.ts'

/** Dispatch closed, value-safe requests; callback URLs are never echoed. */
export async function handleAntigravityAuthRpc(
  service: Pick<BootstrapStatusService, 'status' | 'acknowledgeRisk' | 'startLogin' | 'cancelLogin' | 'logout' | 'revoke' | 'switchAccount' | 'removeAccount'> & { usage?: (signal?: AbortSignal, force?: boolean, accountId?: string) => Promise<QuotaStatusView> },
  endpoint: string,
  payload: unknown,
  signal?: AbortSignal,
  modelCatalog?: AntigravityModelCatalogService,
): Promise<RpcResult<unknown>> {
  if (signal?.aborted === true) return cancelled()

  try {
    if (endpoint === 'status') {
      if (!isEmptyRecord(payload)) return badRequest('status expects an empty payload')
      return { ok: true, value: { status: await service.status() } }
    }
    if (endpoint === 'models') {
      if (!isRefreshPayload(payload)) return badRequest('models expects {} or { force: boolean }')
      if (modelCatalog === undefined) return badRequest('model catalog is unavailable')
      const status = await service.status()
      const gateReady = status.login.projectAvailable
        && status.capabilities.some(capability => capability.id === 'auth-llm' && capability.state === 'available')
      return { ok: true, value: gateReady
        ? await modelCatalog.modelCatalog(signal, payload.force)
        : modelCatalog.catalogSnapshot() }
    }
    if (endpoint === 'usage') {
      if (!isRefreshPayload(payload)) return badRequest('usage expects {} or { force?: boolean, accountId?: string }')
      if (service.usage === undefined) return { ok: true, value: { state: 'protocol-drift' as const } }
      return { ok: true, value: await service.usage(signal, payload.force, payload.accountId) }
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
    if (endpoint === 'logout') {
      if (!isEmptyRecord(payload)) return badRequest('logout expects an empty payload')
      return { ok: true, value: await service.logout() }
    }
    if (endpoint === 'switch-account') {
      if (!isAccountPayload(payload)) return badRequest('switch-account expects { accountId: string }')
      if (typeof service.switchAccount !== 'function') return badRequest('switch-account is not supported')
      return { ok: true, value: { status: await service.switchAccount(payload.accountId) } }
    }
    if (endpoint === 'remove-account') {
      if (!isAccountPayload(payload)) return badRequest('remove-account expects { accountId: string }')
      if (typeof service.removeAccount !== 'function') return badRequest('remove-account is not supported')
      return { ok: true, value: { status: await service.removeAccount(payload.accountId) } }
    }
    if (endpoint === 'revoke') {
      if (!isRevokePayload(payload)) return badRequest('revoke expects { confirmed: true }')
      return { ok: true, value: await service.revoke(true, signal) }
    }
    return badRequest('unknown Antigravity auth endpoint')
  } catch (error) {
    return safeFailure(error)
  }
}

function isAccountPayload(value: unknown): value is { accountId: string } {
  return isRecord(value)
    && Object.keys(value).length === 1
    && typeof value.accountId === 'string'
    && value.accountId.length > 0
    && value.accountId.length <= 4096
}

function badRequest(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

function cancelled(): RpcResult<never> {
  return { ok: false, error: { code: 'cancelled', message: 'antigravity-auth: request cancelled', details: {} } }
}

function safeFailure(error: unknown): RpcResult<never> {
  const credentialError = error instanceof CredentialOperationError ? error : undefined
  const candidate = error instanceof OAuthFlowError
    ? error.code
    : credentialError?.code ?? 'internal'
  const code = isSafeRpcErrorCode(candidate) ? candidate : 'internal'
  return {
    ok: false,
    error: {
      code: code as never,
      message: credentialError === undefined
        ? safeRpcErrorMessage(code)
        : credentialErrorMessage(credentialError.code) ?? safeRpcErrorMessage(code),
      details: {},
    },
  }
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return isRecord(value) && Object.keys(value).length === 0
}

function isRefreshPayload(value: unknown): value is { force?: boolean; accountId?: string } {
  return isRecord(value)
    && Object.keys(value).every(key => key === 'force' || key === 'accountId')
    && (value.force === undefined || typeof value.force === 'boolean')
    && (value.accountId === undefined || (typeof value.accountId === 'string' && isBoundedSafeText(value.accountId, 4096)))
}

function isAcknowledgement(value: unknown): value is { acknowledge: true } {
  return isRecord(value)
    && Object.keys(value).length === 1
    && value.acknowledge === true
}

function isRevokePayload(value: unknown): value is { confirmed: true } {
  return isRecord(value)
    && Object.keys(value).length === 1
    && value.confirmed === true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
