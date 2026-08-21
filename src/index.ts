/** Host half of the private Antigravity bootstrap capability bundle. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { createAntigravityAuthService } from './auth-service.ts'
import { defaultAuthStorePath } from './auth-store.ts'
import { ANTIGRAVITY_AUTH_RPC_CHANNEL, handleAntigravityAuthRpc } from './rpc.ts'

export const name = 'antigravity-auth'
export const inject = ['connection']

/** Mount the Host-only OAuth service and its loopback RPC channel. */
export function apply(ctx: Context): void {
  const service = createAntigravityAuthService({ storePath: defaultAuthStorePath() })
  ctx.inject(['connection'], connectionCtx => connectionCtx.connection.rpc.handle(
    ANTIGRAVITY_AUTH_RPC_CHANNEL,
    (endpoint, payload, signal) => handleAntigravityAuthRpc(service, endpoint, payload, signal),
    { authority: 'loopback' },
  ))
  const disposableContext = ctx as unknown as { effect?: (setup: () => () => Promise<void>, name?: string) => unknown }
  disposableContext.effect?.(() => () => service.dispose(), 'antigravity-auth: OAuth operations')
}

export * from './rpc-contract.ts'
export * from './status.ts'
export * from './wire-identity.ts'
