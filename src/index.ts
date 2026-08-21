/** Host half of the private Antigravity bootstrap capability bundle. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { createBootstrapStatusService } from './status.ts'
import { ANTIGRAVITY_AUTH_RPC_CHANNEL, handleAntigravityAuthRpc } from './rpc.ts'

export const name = 'antigravity-auth'
export const inject = ['connection']

/** Mount the value-free status channel; OAuth and private transport are later gates. */
export function apply(ctx: Context): void {
  const service = createBootstrapStatusService()
  ctx.inject(['connection'], connectionCtx => connectionCtx.connection.rpc.handle(
    ANTIGRAVITY_AUTH_RPC_CHANNEL,
    (endpoint, payload, signal) => handleAntigravityAuthRpc(service, endpoint, payload, signal),
    { authority: 'loopback' },
  ))
}

export * from './rpc-contract.ts'
export * from './status.ts'
export * from './wire-identity.ts'
