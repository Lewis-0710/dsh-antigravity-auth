/** Dedicated grounded Web Search provider and independently mounted Search row. */

import type { Context } from '@deepseek-ai/cordis'
import { resolveModelWithTier } from '@cortexkit/antigravity-auth-core'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { createAntigravityAuthService } from './auth-service.ts'
import type { AntigravityAuthService } from './auth-service.ts'
import type { CredentialCoordinator, HostCredential } from './credential-coordinator.ts'
import {
  DEFAULT_PRIVATE_FRAME_BYTES,
  DEFAULT_PRIVATE_IDLE_TIMEOUT_MS,
  DEFAULT_PRIVATE_RESPONSE_BYTES,
  DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS,
  PrivateTransportError,
  createPrivateTransport,
  iteratePrivateSse,
  privateStatusError,
  type PrivateTransport,
} from './private-transport.ts'
import { ANTIGRAVITY_PROVIDER } from './llm-adapter.ts'
import { ANTIGRAVITY_WIRE_ORIGIN } from './wire-identity.ts'

export const name = 'antigravity-search'
export const inject = ['web', 'antigravityAuth']
export const ANTIGRAVITY_SEARCH_PROVIDER_ID = 'antigravity'
export const ANTIGRAVITY_SEARCH_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:generateContent` as const
export const ANTIGRAVITY_SEARCH_MODEL = 'antigravity-gemini-3.7-flash'
export const ANTIGRAVITY_SEARCH_SETTINGS_NAMESPACE = settingsNamespace('antigravity-search')

export interface AntigravitySearchSettings {
  enabled: boolean
  model: string
  maxResults: number
}

export interface Config extends AntigravitySearchSettings {}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  model: z.string().default(ANTIGRAVITY_SEARCH_MODEL),
  maxResults: z.number().step(1).min(1).max(50).default(10),
})

export interface AntigravitySearchProviderOptions {
  readonly auth: Pick<CredentialCoordinator, 'credential'> | { credential(signal?: AbortSignal): Promise<HostCredential | undefined> }
  readonly enabled?: () => boolean
  readonly settings?: () => AntigravitySearchSettings
  readonly transport?: PrivateTransport
  readonly fetchImpl?: typeof fetch
  readonly maxResponseBytes?: number
}

export class AntigravitySearchProvider implements WebSearchProvider {
  readonly id = ANTIGRAVITY_SEARCH_PROVIDER_ID
  private readonly enabled: () => boolean

  constructor(private readonly options: AntigravitySearchProviderOptions) {
    this.enabled = options.enabled ?? (() => options.settings?.().enabled ?? true)
  }

  available(): boolean {
    return this.enabled()
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (!this.enabled()) throw new WebError('Antigravity Web Search is disabled by its capability gate', 'ANTIGRAVITY_SEARCH_DISABLED')
    if (signal?.aborted === true) throw new WebError('Antigravity Web Search was cancelled', 'ANTIGRAVITY_SEARCH_CANCELLED')
    if (typeof request.query !== 'string' || request.query.trim().length === 0 || request.query.length > 16_384) {
      throw new WebError('Antigravity Web Search requires a bounded query', 'ANTIGRAVITY_SEARCH_INVALID_QUERY')
    }
    const settings = this.options.settings?.() ?? { enabled: true, model: ANTIGRAVITY_SEARCH_MODEL, maxResults: 10 }
    const configuredMax = boundedInteger(settings.maxResults, 1, 50)
    const requestedMax = request.maxResults === undefined ? configuredMax : boundedInteger(request.maxResults, 1, 50)
    const maxResults = Math.min(configuredMax, requestedMax)
    const credential = await this.options.auth.credential(signal)
    if (credential === undefined) throw new WebError('Antigravity Web Search requires a logged-in account', 'ANTIGRAVITY_SEARCH_AUTH_REQUIRED')
    const transport = this.options.transport ?? (this.options.fetchImpl === undefined ? createPrivateTransport() : createPrivateTransport({ fetchImpl: this.options.fetchImpl }))
    const response = await transport.request({
      url: ANTIGRAVITY_SEARCH_ENDPOINT,
      accessToken: credential.accessToken,
      body: JSON.stringify(buildGroundedSearchPayload(request.query.trim(), credential, settings.model)),
      ...(signal === undefined ? {} : { signal }),
    }).catch(error => { throw toWebError(error) })
    const statusError = privateStatusError(response.status)
    if (statusError !== undefined) {
      await response.body?.cancel().catch(() => {})
      throw toWebError(statusError)
    }
    const sources: WebSearchSource[] = []
    const seen = new Set<string>()
    const content: string[] = []
    let truncated = false
    try {
      for await (const event of iteratePrivateSse(response, {
        ...(signal === undefined ? {} : { signal }),
        idleTimeoutMs: DEFAULT_PRIVATE_IDLE_TIMEOUT_MS,
        totalTimeoutMs: DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS,
        maxBytes: this.options.maxResponseBytes ?? DEFAULT_PRIVATE_RESPONSE_BYTES,
        maxFrameBytes: DEFAULT_PRIVATE_FRAME_BYTES,
      })) {
        if (event.data.trim() === '[DONE]') continue
        const value = parseJson(event.data)
        truncated ||= collectSearchFacts(value, content, sources, seen, maxResults)
      }
    } catch (error) {
      throw toWebError(error)
    }
    if (sources.length === 0) throw new WebError('Antigravity Search returned no validated grounding sources', 'ANTIGRAVITY_SEARCH_NO_SOURCES')
    return {
      ...(content.length === 0 ? {} : { content: content.join('').slice(0, 64 * 1024) }),
      sources,
      truncated,
    }
  }
}

export function buildGroundedSearchPayload(query: string, credential: Pick<HostCredential, 'projectId'>, model = ANTIGRAVITY_SEARCH_MODEL): Record<string, unknown> {
  return {
    project: credential.projectId,
    model: resolveModelWithTier(model, { cli_first: false }).actualModel,
    request: {
      contents: [{ role: 'user', parts: [{ text: query }] }],
      tools: [{ googleSearch: {} }],
      systemInstruction: { parts: [{ text: 'Return a concise grounded answer with only sources supplied by the provider.' }] },
    },
  }
}

/** Mount only the public Web Search seam; no fetch provider is registered. */
export function apply(ctx?: Context, config: Config = { enabled: true, model: ANTIGRAVITY_SEARCH_MODEL, maxResults: 10 }): void {
  if (ctx === undefined) return
  const candidate = ctx as unknown as { web?: { registerSearchProvider: (value: WebSearchProvider) => () => void }; get?: (name: string) => unknown }
  if (candidate.web === undefined) return
  let current = (): AntigravitySearchSettings => config
  let dispose: (() => void) | undefined
  let sync = (): void => {}
  installSettingsSection(ctx, ANTIGRAVITY_SEARCH_SETTINGS_NAMESPACE, Config, config, {
    setSource: source => { current = source; sync() },
    onChange: () => { sync() },
  })
  const provided = candidate.get?.('antigravityAuth')
  const auth = isAuthService(provided) ? provided : createAntigravityAuthService()
  const ownsAuth = auth !== provided
  let projectReady = typeof auth.status !== 'function'
  let unwatch: (() => void) | undefined
  sync = () => {
    if (current().enabled && projectReady && dispose === undefined) dispose = candidate.web!.registerSearchProvider(new AntigravitySearchProvider({ auth, settings: current }))
    else if ((!current().enabled || !projectReady) && dispose !== undefined) { dispose(); dispose = undefined }
  }
  const refreshGate = async (): Promise<void> => {
    if (typeof auth.status !== 'function') return
    try { projectReady = (await auth.status()).login.projectAvailable } catch { projectReady = false }
    sync()
  }
  unwatch = auth.watchStatus?.(() => { void refreshGate() })
  sync()
  void refreshGate()
  const lifecycle = ctx as unknown as { effect?: (setup: () => () => Promise<void>, label?: string) => unknown }
  lifecycle.effect?.(() => async () => { unwatch?.(); dispose?.(); dispose = undefined; if (ownsAuth) await auth.dispose() }, 'antigravity-search: provider lifecycle')
}

function collectSearchFacts(
  value: unknown,
  content: string[],
  sources: WebSearchSource[],
  seen: Set<string>,
  maxResults: number,
): boolean {
  if (!isRecord(value)) return false
  const root = isRecord(value.response) ? value.response : value
  const texts = [findText(root)]
  const metadataValues: unknown[] = [root.groundingMetadata, root.grounding_metadata, value.groundingMetadata]
  if (Array.isArray(root.candidates)) {
    for (const candidate of root.candidates) {
      if (!isRecord(candidate)) continue
      texts.push(findText(candidate))
      if (isRecord(candidate.content)) texts.push(findText(candidate.content))
      metadataValues.push(candidate.groundingMetadata, candidate.grounding_metadata)
    }
  }
  for (const text of texts) appendBounded(content, text)
  let truncated = false
  for (const rawMetadata of metadataValues) {
    if (!isRecord(rawMetadata)) continue
    const chunks = rawMetadata.groundingChunks ?? rawMetadata.grounding_chunks
    if (!Array.isArray(chunks)) continue
    for (const chunk of chunks) {
      if (!isRecord(chunk)) continue
      const web = isRecord(chunk.web) ? chunk.web : isRecord(chunk.webSource) ? chunk.webSource : undefined
      if (web === undefined || typeof web.uri !== 'string' || !isHttpUrl(web.uri)) continue
      const url = web.uri
      if (seen.has(url)) continue
      seen.add(url)
      if (sources.length >= maxResults) {
        truncated = true
        continue
      }
      const title = safeSourceText(web.title, 1024)
      const snippet = safeSourceText(web.snippet, 4096)
      sources.push({ url, ...(title === undefined ? {} : { title }), ...(snippet === undefined ? {} : { snippet }) })
    }
  }
  return truncated
}

function appendBounded(output: string[], value: string | undefined): void {
  if (value === undefined || value.length === 0) return
  const used = output.reduce((total, item) => total + item.length, 0)
  if (used < 64 * 1024) output.push(value.slice(0, 64 * 1024 - used))
}

function findText(value: Record<string, unknown>): string | undefined {
  const parts = Array.isArray(value.parts) ? value.parts : isRecord(value.content) && Array.isArray(value.content.parts) ? value.content.parts : []
  const output: string[] = []
  for (const part of parts) {
    if (!isRecord(part) || typeof part.text !== 'string' || hasControl(part.text)) continue
    output.push(part.text.slice(0, 64 * 1024))
  }
  return output.length === 0 ? undefined : output.join('').slice(0, 64 * 1024)
}

function safeSourceText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !hasControl(value) ? value : undefined
}

function hasControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 32 || code === 127) return true
  }
  return false
}

function parseJson(value: string): unknown {
  const normalized = value.trim().replace(/^\)\]\}'(?:\r?\n)?/u, '')
  try { return JSON.parse(normalized) as unknown } catch { throw new WebError('Antigravity Search returned malformed provider data', 'ANTIGRAVITY_SEARCH_PROTOCOL_DRIFT') }
}

function toWebError(error: unknown): WebError {
  if (error instanceof WebError) return error
  if (error instanceof PrivateTransportError) {
    const code = error.code === 'authentication' ? 'ANTIGRAVITY_SEARCH_AUTH_REQUIRED'
      : error.code === 'forbidden' ? 'ANTIGRAVITY_SEARCH_FORBIDDEN'
        : error.code === 'rate-limited' ? 'ANTIGRAVITY_SEARCH_RATE_LIMITED'
          : error.code === 'timeout' ? 'ANTIGRAVITY_SEARCH_TIMEOUT'
            : error.code === 'cancelled' ? 'ANTIGRAVITY_SEARCH_CANCELLED'
              : 'ANTIGRAVITY_SEARCH_PROTOCOL_DRIFT'
    return new WebError('The Antigravity Search request failed safely', code)
  }
  return new WebError('The Antigravity Search request failed safely', 'ANTIGRAVITY_SEARCH_FAILED')
}

function isAuthService(value: unknown): value is AntigravityAuthService {
  return isRecord(value) && typeof value.credential === 'function'
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username.length === 0 && url.password.length === 0
  } catch { return false }
}

function boundedInteger(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new WebError('Antigravity Search result limit is invalid', 'ANTIGRAVITY_SEARCH_INVALID_QUERY')
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

void ANTIGRAVITY_PROVIDER
