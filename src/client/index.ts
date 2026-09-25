/** Browser half of the private Antigravity bootstrap capability bundle. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createAntigravityAuthRpcClient } from '../rpc-contract.ts'
import { AntigravityAuthSettings } from './AntigravityAuthSettings.tsx'
import { en, zh, type AntigravityAuthKey } from './locales.ts'
import type { AntigravityAuthSettingsProps } from './AntigravityAuthSettings.tsx'
import type { AntigravitySearchSettings } from '../search.ts'
import type { AntigravityImageSettings } from '../image.ts'
import type { AntigravityVideoSettings } from '../video.ts'

const NS = 'settings.antigravityAuth'

import { installSettingsNavIcon } from './settings-nav-icon.ts'

export { AntigravityAuthSettings } from './AntigravityAuthSettings.tsx'
export type { AntigravityAuthSettingsProps } from './AntigravityAuthSettings.tsx'
export { en, zh } from './locales.ts'
export type { AntigravityAuthKey } from './locales.ts'
export { installSettingsNavIcon } from './settings-nav-icon.ts'

/** Client services required by the settings section and its loopback RPC. */
export const inject = ['slots', 'locale', 'connection']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy for the Antigravity bootstrap settings section. */
    'settings.antigravityAuth': AntigravityAuthKey
  }
}

function resolveService<T = unknown>(ctx: ClientContext, name: string): T | undefined {
  try {
    if (typeof (ctx as unknown as { get?: (name: string) => unknown }).get === 'function') {
      const svc = (ctx as unknown as { get: (name: string) => unknown }).get(name)
      if (svc !== undefined) return svc as T
    }
  } catch {}
  try {
    return (ctx as unknown as Record<string, unknown>)[name] as T
  } catch {}
  return undefined
}

/** Register one disposable settings section and no capability controls. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'antigravity-auth: copy dictionaries')

  const connection = ctx.get('connection') as unknown as ConnectionHandle
  if (!connection.isLoopback) return
  const rpc = createAntigravityAuthRpcClient(connection.rpc)
  const t = ctx.locale.bind(NS) as AntigravityAuthSettingsProps['t']
  const configForms = resolveService<{ get<T>(namespace: string): SettingsScope<T> }>(ctx, 'configForms')
  const settingsScope = resolveService<{ bind<T>(spec: { namespace: string; decode?: (value: unknown) => T | undefined }): SettingsScope<T> }>(ctx, 'settingsScope')
  const bindScope = <T>(namespace: string, decode?: (value: unknown) => T | undefined): SettingsScope<T> | undefined => {
    if (configForms && typeof configForms.get === 'function') {
      return configForms.get<T>(namespace)
    }
    if (settingsScope && typeof settingsScope.bind === 'function') {
      return settingsScope.bind<T>({ namespace, ...(decode !== undefined ? { decode } : {}) })
    }
    return undefined
  }
  const searchScope = bindScope<AntigravitySearchSettings>('antigravity-search', decodeSearchSettings)
  const imageScope = bindScope<AntigravityImageSettings>('antigravity-image', decodeImageSettings)
  const videoScope = bindScope<AntigravityVideoSettings>('antigravity-video', decodeVideoSettings)
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  const reset = (): void => {
    for (const listener of listeners) listener()
  }
  ctx.effect(() => ctx.on('connection/reset', reset), 'antigravity-auth: connection invalidation')

  installSettingsNavIcon(ctx, () => t('nav'))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'antigravity-auth',
    order: 20,
    label: () => t('nav'),
    inject: (): AntigravityAuthSettingsProps => ({
      rpc,
      t,
      subscribe,
      ...(searchScope !== undefined ? { searchScope } : {}),
      ...(imageScope !== undefined ? { imageScope } : {}),
      ...(videoScope !== undefined ? { videoScope } : {}),
    }),
  }, AntigravityAuthSettings))
}

function decodeSearchSettings(value: unknown): AntigravitySearchSettings | undefined {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || typeof value.model !== 'string' || value.model.length === 0 || !positiveInteger(value.maxResults) || value.maxResults > 50) return undefined
  return { enabled: value.enabled, model: value.model, maxResults: value.maxResults }
}

function decodeImageSettings(value: unknown): AntigravityImageSettings | undefined {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || typeof value.model !== 'string' || value.model.length === 0 || !positiveInteger(value.n) || value.n > 4) return undefined
  return { enabled: value.enabled, model: value.model, n: value.n }
}

function decodeVideoSettings(value: unknown): AntigravityVideoSettings | undefined {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || typeof value.model !== 'string' || value.model.length === 0) return undefined
  if (value.maxBytes !== undefined && (!positiveInteger(value.maxBytes) || value.maxBytes > 128 * 1024 * 1024)) return undefined
  return { enabled: value.enabled, model: value.model, ...(typeof value.maxBytes === 'number' ? { maxBytes: value.maxBytes } : {}) }
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
