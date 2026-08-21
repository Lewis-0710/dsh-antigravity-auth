/** Host dispatcher for the bootstrap shell's loopback RPC channel. */

import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { BootstrapStatusService } from './status.ts'

export { ANTIGRAVITY_AUTH_RPC_CHANNEL } from './rpc-contract.ts'

/** Dispatch only closed, value-free requests; no endpoint performs I/O. */
export async function handleAntigravityAuthRpc(
  service: BootstrapStatusService,
  endpoint: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<RpcResult<unknown>> {
  if (signal?.aborted === true) return cancelled()

  try {
    if (endpoint === 'status') {
      if (!isEmptyRecord(payload)) return badRequest('status expects an empty payload')
      return { ok: true, value: { status: service.status() } }
    }
    if (endpoint === 'acknowledge-risk') {
      if (!isAcknowledgement(payload)) return badRequest('acknowledge-risk expects { acknowledge: true }')
      return { ok: true, value: service.acknowledgeRisk() }
    }
    if (endpoint === 'login') {
      if (!isEmptyRecord(payload)) return badRequest('login expects an empty payload')
      const result = service.beginLogin()
      return result === undefined
        ? badRequest('risk acknowledgement is required before login can begin')
        : { ok: true, value: result }
    }
    return badRequest('unknown Antigravity auth endpoint')
  } catch {
    return {
      ok: false,
      error: {
        code: 'internal',
        message: 'antigravity-auth: bootstrap operation failed',
        details: {},
      },
    }
  }
}

function badRequest(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

function cancelled(): RpcResult<never> {
  return { ok: false, error: { code: 'cancelled', message: 'antigravity-auth: request cancelled', details: {} } }
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return isRecord(value) && Object.keys(value).length === 0
}

function isAcknowledgement(value: unknown): value is { acknowledge: true } {
  return isRecord(value)
    && Object.keys(value).length === 1
    && value.acknowledge === true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
