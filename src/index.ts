/** Host half of the private Antigravity bootstrap capability bundle. */

import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-llm'
import { createAntigravityAuthService } from './auth-service.ts'
import { AntigravityAdapter, ANTIGRAVITY_PROVIDER } from './llm-adapter.ts'
import { defaultAuthStorePath } from './auth-store.ts'
import { ANTIGRAVITY_AUTH_RPC_CHANNEL, handleAntigravityAuthRpc } from './rpc.ts'

export const name = 'antigravity-auth'
export const inject = ['connection', 'llm', 'attachments']

/** Mount the Host-only OAuth service and its loopback RPC channel. */
export function apply(ctx: Context): void {
  const service = createAntigravityAuthService({ storePath: defaultAuthStorePath() })
  const contextWithProvide = ctx as Context & { provide?: (name: string, value: unknown) => () => Promise<void> | void }
  const unprovide = contextWithProvide.provide?.('antigravityAuth', service) ?? (() => {})
  ctx.inject(['connection'], connectionCtx => connectionCtx.connection.rpc.handle(
    ANTIGRAVITY_AUTH_RPC_CHANNEL,
    (endpoint, payload, signal) => handleAntigravityAuthRpc(service, endpoint, payload, signal),
    { authority: 'loopback' },
  ))
  const runtime = ctx as unknown as {
    llm?: {
      listProviders?: () => readonly { id: string }[]
      registerAdapter?: (providers: string[], adapter: AntigravityAdapter) => (() => void) & { replace?: (providers: string[]) => void }
    }
    attachments?: Pick<AttachmentStore, 'readImage'>
  }
  let registration: (() => void) | undefined
  const syncAdapter = async (): Promise<void> => {
    if (runtime.llm?.registerAdapter === undefined) return
    let status: Awaited<ReturnType<typeof service.status>>
    try { status = await service.status() } catch { return }
    const shouldRegister = status.login.projectAvailable
    if (shouldRegister && registration === undefined) {
      if (runtime.llm.listProviders?.().some(provider => provider.id === ANTIGRAVITY_PROVIDER)) return
      registration = runtime.llm.registerAdapter([ANTIGRAVITY_PROVIDER], new AntigravityAdapter({
        auth: service,
        ...(runtime.attachments === undefined ? {} : { attachments: runtime.attachments }),
      }))
    } else if (!shouldRegister && registration !== undefined) {
      registration()
      registration = undefined
    }
  }
  void syncAdapter()
  const unwatch = service.watchStatus(() => { void syncAdapter() })
  const disposableContext = ctx as unknown as { effect?: (setup: () => () => Promise<void>, name?: string) => unknown }
  disposableContext.effect?.(() => async () => {
    unwatch()
    registration?.()
    registration = undefined
    await unprovide()
    await service.dispose()
  }, 'antigravity-auth: OAuth and LLM operations')
}

export * from './auth-service.ts'
export * from './credential-coordinator.ts'
export * from './rpc-contract.ts'
export * from './status.ts'
export * from './project-context.ts'
export * from './wire-identity.ts'
export * from './llm-adapter.ts'
export * from './private-transport.ts'
export * from './replay.ts'
export * from './quota.ts'
export * from './media-admission.ts'
