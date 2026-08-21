/** Public DSH LLM adapter for the single Antigravity provider route. */

import { Buffer } from 'node:buffer'
import {
  AgyRequestSessionStore,
  applyClaudeTransforms,
  applyGeminiTransforms,
  buildAgyAgentRequestMetadata,
  fnv1a64Signed,
  getPublicModelDefinitions,
  getQuotaGroupForModel,
  resolveModelWithTier,
} from '@cortexkit/antigravity-auth-core'
import {
  CallId,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  resolveRetryPolicy,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  FinishReason,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  Message,
  ReplayEnvelope,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type { CredentialCoordinator, HostCredential } from './credential-coordinator.ts'
import {
  DEFAULT_PRIVATE_FRAME_BYTES,
  DEFAULT_PRIVATE_IDLE_TIMEOUT_MS,
  DEFAULT_PRIVATE_RESPONSE_BYTES,
  DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS,
  DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS,
  PrivateTransportError,
  createPrivateTransport,
  iteratePrivateSse,
  privateStatusError,
  type PrivateTransport,
  type PrivateTransportOptions,
} from './private-transport.ts'
import {
  antigravityModelFamily,
  buildFunctionDeclarations,
  compatibleReplayState,
  createReplayState,
  type AntigravityReplayBlock,
} from './replay.ts'
import {
  ANTIGRAVITY_WIRE_ORIGIN,
  createWireIdentity,
  type WireIdentity,
} from './wire-identity.ts'

export const ANTIGRAVITY_PROVIDER = 'google-antigravity' as const
export const ANTIGRAVITY_STREAM_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:streamGenerateContent` as const
export const ANTIGRAVITY_GENERATE_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:generateContent` as const
export const ANTIGRAVITY_LLM_ROUTE = ANTIGRAVITY_PROVIDER

export interface AntigravityAuthCredentialSource {
  credential(signal?: AbortSignal, options?: { readonly forceRefresh?: boolean }): Promise<HostCredential | undefined>
}

export interface AntigravityAdapterOptions {
  readonly auth: Pick<CredentialCoordinator, 'credential'> | AntigravityAuthCredentialSource
  readonly wireIdentity?: WireIdentity
  readonly transport?: PrivateTransport
  readonly transportOptions?: PrivateTransportOptions
  readonly fetchImpl?: typeof fetch
  readonly responseHeaderTimeoutMs?: number
  readonly idleTimeoutMs?: number
  readonly totalTimeoutMs?: number
  readonly maxResponseBytes?: number
  readonly maxFrameBytes?: number
  readonly attachments?: Pick<AttachmentStore, 'readImage'>
}

interface ProviderPartText {
  readonly kind: 'text' | 'reasoning'
  readonly text: string
  readonly signature?: string
}

interface ProviderPartTool {
  readonly kind: 'tool-call'
  readonly name?: string
  readonly id?: string
  readonly arguments: string
  readonly signature?: string
}

type ProviderPart = ProviderPartText | ProviderPartTool

interface ProviderEvent {
  readonly parts: readonly ProviderPart[]
  readonly usage?: TokenUsage
  readonly finish?: string
  readonly error?: { readonly status?: number; readonly code?: string }
}

export interface AntigravityRequestMetadata {
  readonly requestId: string
  readonly sessionId: string
  readonly labels: Record<string, string>
  readonly lastStepIndex: number
}

/** Adapter that owns exactly one provider route and no fallback route. */
export class AntigravityAdapter extends LlmAdapter {
  private readonly transport: PrivateTransport
  private readonly wire: WireIdentity
  private readonly sessions = new AgyRequestSessionStore('dsh-antigravity-auth')
  private readonly options: Required<Pick<AntigravityAdapterOptions, 'idleTimeoutMs' | 'totalTimeoutMs' | 'maxResponseBytes' | 'maxFrameBytes'>> & {
    readonly responseHeaderTimeoutMs: number
  }
  private readonly definitions = getPublicModelDefinitions()

  constructor(private readonly adapterOptions: AntigravityAdapterOptions) {
    super()
    this.wire = adapterOptions.wireIdentity ?? createWireIdentity()
    this.transport = adapterOptions.transport ?? createPrivateTransport({
      ...(adapterOptions.fetchImpl === undefined ? {} : { fetchImpl: adapterOptions.fetchImpl }),
      wireIdentity: this.wire,
      ...(adapterOptions.responseHeaderTimeoutMs === undefined ? {} : { responseHeaderTimeoutMs: adapterOptions.responseHeaderTimeoutMs }),
    })
    this.options = {
      responseHeaderTimeoutMs: positive(adapterOptions.responseHeaderTimeoutMs, DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS),
      idleTimeoutMs: positive(adapterOptions.idleTimeoutMs, DEFAULT_PRIVATE_IDLE_TIMEOUT_MS),
      totalTimeoutMs: positive(adapterOptions.totalTimeoutMs, DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS),
      maxResponseBytes: positive(adapterOptions.maxResponseBytes, DEFAULT_PRIVATE_RESPONSE_BYTES),
      maxFrameBytes: positive(adapterOptions.maxFrameBytes, DEFAULT_PRIVATE_FRAME_BYTES),
    }
  }

  override providerInfo(provider: string): LlmProviderInfo {
    if (provider !== ANTIGRAVITY_PROVIDER) throw new LlmError('Unknown Antigravity provider route', 'NO_ADAPTER')
    return { id: ANTIGRAVITY_PROVIDER, name: 'Google Antigravity (unofficial)' }
  }

  override providerRetryPolicy(): ReturnType<typeof resolveRetryPolicy> {
    // Generation dispatch is never retried by this adapter; a normal runtime
    // retry policy must not dispatch the same metered request a second time.
    return resolveRetryPolicy({ mode: 'normal', maxRetries: 0, retryableCodes: [] }, 'google-antigravity')
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    this.providerInfo(provider)
    return Object.values(this.definitions).filter(definition => !definition.modalities.output.includes('image')).map(definition => ({
      provider: ANTIGRAVITY_PROVIDER,
      id: definition.id,
      name: definition.name,
      description: `${definition.name} · audited snapshot · quota ${getQuotaGroupForModel(definition.id) ?? 'unknown'}`,
      inputModalities: definition.modalities.input.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image'),
    }))
  }

  override async resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    this.providerInfo(provider)
    if (typeof model !== 'string' || model.trim().length === 0 || model.length > 256) {
      throw new LlmError('The Antigravity model id is invalid', 'INVALID_MODEL')
    }
    const definition = this.definitions[model]
    if (definition === undefined || definition.modalities.output.includes('image')) {
      throw new LlmError('The Antigravity model is not in the audited text model snapshot', 'INVALID_MODEL')
    }
    const effortIds = Object.entries(definition.variants ?? {})
      .filter(([, variant]) => variant.disabled !== true)
      .map(([id]) => ({ id: ReasoningEffortId(id), name: id }))
    return {
      provider: ANTIGRAVITY_PROVIDER,
      id: definition.id,
      name: definition.name,
      description: 'Pinned community snapshot; live account availability is checked independently.',
      inputModalities: definition.modalities.input.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image'),
      context: { contextWindow: definition.limit.context },
      defaultMaxTokens: definition.limit.output,
      ...(effortIds.length === 0 ? {} : { reasoning: { efforts: effortIds } }),
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.provider !== ANTIGRAVITY_PROVIDER) {
      throw new LlmError('The Antigravity adapter received an unknown provider route', 'NO_ADAPTER')
    }
    const signal = options.signal
    const requestedDefinition = this.definitions[options.model]
    if (requestedDefinition === undefined || requestedDefinition.modalities.output.includes('image')) throw new LlmError('The Antigravity model is not in the audited text model snapshot', 'INVALID_MODEL')
    if (isAborted(signal)) {
      yield finishChunk('aborted', 'CANCELLED')
      return
    }
    const hasEmitted = { value: false }
    let replayed = false
    for (;;) {
      const credential = await this.readCredential(signal, replayed)
      if (credential === undefined) {
        throw new LlmError('Antigravity login is required before model use', 'AUTH')
      }
      const sessionKey = requestSessionKey(options)
      const requestScope = this.sessions.beginRequest(sessionKey)
      let payload: Record<string, unknown>
      try {
        payload = await buildAntigravityGeneratePayloadForAdapter(options, credential, requestScope.session, requestScope.timestamp, this.adapterOptions.attachments)
      } catch (error) {
        if (error instanceof LlmError) throw error
        throw new LlmError('The Antigravity image input could not be admitted safely', 'UNSUPPORTED_MODALITY')
      }
      let response: Response
      try {
        response = await this.transport.request({
          url: ANTIGRAVITY_STREAM_ENDPOINT,
          accessToken: credential.accessToken,
          body: JSON.stringify(payload),
          ...(signal === undefined ? {} : { signal }),
          responseHeaderTimeoutMs: this.options.responseHeaderTimeoutMs,
        })
      } catch (error) {
        throw toLlmError(error)
      }
      const statusError = privateStatusError(response.status)
      if (statusError !== undefined) {
        if (statusError.code === 'authentication' && !replayed && !hasEmitted.value && !isAborted(signal)) {
          await cancelResponse(response)
          replayed = true
          continue
        }
        throw toLlmError(statusError)
      }
      try {
        yield* this.streamResponse(response, options, hasEmitted)
        this.sessions.completeExecution(sessionKey)
        return
      } catch (error) {
        const privateError = error instanceof PrivateTransportError ? error : undefined
        if (privateError?.code === 'authentication' && !replayed && !hasEmitted.value && !isAborted(signal)) {
          replayed = true
          continue
        }
        throw toLlmError(error)
      }
    }
  }

  private async *streamResponse(
    response: Response,
    options: GenerateOptions,
    hasEmitted: { value: boolean },
  ): AsyncGenerator<StreamChunk> {
    const states: BlockState[] = []
    let current: BlockState | undefined
    let usage: TokenUsage | undefined
    let finish: string | undefined
    let eventError: ProviderEvent['error']
    for await (const sse of iteratePrivateSse(response, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      idleTimeoutMs: this.options.idleTimeoutMs,
      totalTimeoutMs: this.options.totalTimeoutMs,
      maxBytes: this.options.maxResponseBytes,
      maxFrameBytes: this.options.maxFrameBytes,
    })) {
      if (sse.data.trim() === '[DONE]') continue
      const event = parseProviderEvent(sse.data)
      if (event.error !== undefined) {
        eventError = event.error
        if (event.error.status === 401 || isAuthenticationCode(event.error.code)) throw new PrivateTransportError('authentication', 'The private endpoint requires authentication', { status: event.error.status ?? 401 })
        break
      }
      if (event.usage !== undefined) usage = event.usage
      if (event.finish !== undefined) finish = event.finish
      for (const part of event.parts) {
        if (current === undefined || !sameBlock(current, part)) {
          if (current !== undefined) {
            yield endBlock(current)
          }
          current = beginBlock(states, part)
          yield { type: 'block-start', index: current.index, blockType: current.kind }
        }
        if (part.kind === 'tool-call') {
          current.text += part.arguments
          hasEmitted.value ||= part.arguments.length > 0 || part.name !== undefined
          yield {
            type: 'tool-call-delta',
            index: current.index,
            id: current.id,
            ...(part.name === undefined ? {} : { name: part.name }),
            argumentsDelta: part.arguments,
          }
          if (part.signature !== undefined) current.signature = part.signature
        } else if (part.kind === 'reasoning') {
          current.text += part.text
          hasEmitted.value ||= part.text.length > 0
          if (part.text.length > 0) yield { type: 'reasoning-delta', index: current.index, text: part.text }
        } else {
          current.text += part.text
          hasEmitted.value ||= part.text.length > 0
          if (part.text.length > 0) yield { type: 'text-delta', index: current.index, text: part.text }
        }
      }
    }
    if (current !== undefined) yield endBlock(current)
    if (usage !== undefined) yield { type: 'usage', usage }
    if (eventError !== undefined) {
      yield finishChunk('error', safeProviderErrorCode(eventError.code), safeProviderStatus(eventError.status))
      return
    }
    if (isAborted(options.signal)) {
      yield finishChunk('aborted', 'CANCELLED')
      return
    }
    if (states.length === 0) {
      yield finishChunk('error', 'EMPTY_RESPONSE')
      return
    }
    const replayBlocks: AntigravityReplayBlock[] = states.map(state => ({
      kind: state.kind,
      ...(state.signature === undefined ? {} : { signature: state.signature }),
    }))
    const replayState = createReplayState(options.model, antigravityModelFamily(options.model), finish, replayBlocks)
    yield finishChunk(mapFinishReason(finish), finish ?? 'STOP', undefined, replayState)
  }

  private async readCredential(signal: AbortSignal | undefined, forceRefresh: boolean): Promise<HostCredential | undefined> {
    try {
      return await this.adapterOptions.auth.credential(signal, forceRefresh ? { forceRefresh: true } : undefined)
    } catch (error) {
      throw toLlmError(error)
    }
  }
}

interface BlockState {
  readonly index: number
  readonly kind: 'text' | 'reasoning' | 'tool-call'
  readonly id: ReturnType<typeof CallId>
  readonly name?: string
  text: string
  signature?: string
}

function beginBlock(states: BlockState[], part: ProviderPart): BlockState {
  const index = states.length
  const block: BlockState = part.kind === 'tool-call'
    ? {
        index,
        kind: 'tool-call',
        id: CallId(part.id ?? `antigravity-call-${String(index)}`),
        ...(part.name === undefined ? {} : { name: part.name }),
        text: '',
        ...(part.signature === undefined ? {} : { signature: part.signature }),
      }
    : {
        index,
        kind: part.kind,
        id: CallId(`antigravity-block-${String(index)}`),
        text: '',
        ...(part.signature === undefined ? {} : { signature: part.signature }),
      }
  states.push(block)
  return block
}

function sameBlock(state: BlockState, part: ProviderPart): boolean {
  if (state.kind !== part.kind) return false
  return part.kind !== 'tool-call' || (part.id === undefined || part.id === String(state.id))
}

function endBlock(state: BlockState): StreamChunk {
  if (state.kind === 'text') return { type: 'block-end', index: state.index, block: { type: 'text', text: state.text } }
  if (state.kind === 'reasoning') return { type: 'block-end', index: state.index, block: { type: 'reasoning', text: state.text } }
  let parsed: unknown
  try {
    parsed = JSON.parse(state.text) as unknown
  } catch {
    throw new PrivateTransportError('protocol-drift', 'The private tool-call arguments were incomplete JSON')
  }
  if (!isRecord(parsed)) throw new PrivateTransportError('protocol-drift', 'The private tool-call arguments were not an object')
  const args = state.text
  return {
    type: 'block-end',
    index: state.index,
    block: {
      type: 'tool-call',
      id: state.id,
      name: state.name ?? 'unknown_tool',
      arguments: args,
    },
  }
}

export function buildAntigravityGeneratePayload(options: GenerateOptions, credential: HostCredential): Record<string, unknown> {
  const contents = options.messages
    .filter(message => message.role !== 'system')
    .map(message => mapMessage(message, options.model))
  return buildPayloadFromContents(options, credential, contents)
}

async function buildAntigravityGeneratePayloadForAdapter(
  options: GenerateOptions,
  credential: HostCredential,
  session: Parameters<typeof buildAgyAgentRequestMetadata>[0],
  timestamp: number,
  attachments: Pick<AttachmentStore, 'readImage'> | undefined,
): Promise<Record<string, unknown>> {
  const contents: Record<string, unknown>[] = []
  for (const message of options.messages) {
    if (message.role === 'system') continue
    contents.push(await mapMessageWithAttachments(message, options.model, attachments, options.signal))
  }
  const payload = buildPayloadFromContents(options, credential, contents)
  const metadata = buildAgyAgentRequestMetadata(session, payload.request as Record<string, unknown>, resolveWireModel(options.model), timestamp)
  const request = payload.request as Record<string, unknown>
  request.labels = metadata.labels
  request.sessionId = metadata.sessionId
  return {
    ...payload,
    requestId: metadata.requestId,
    requestType: 'agent',
  }
}

function buildPayloadFromContents(
  options: GenerateOptions,
  credential: HostCredential,
  contents: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const wireModel = resolveWireModel(options.model)
  const request: Record<string, unknown> = { contents }
  if (options.system !== undefined && options.system.trim().length > 0) {
    request.systemInstruction = { parts: [{ text: options.system.slice(0, 64 * 1024) }] }
  }
  const generationConfig: Record<string, unknown> = {}
  if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = boundedInteger(options.maxTokens, 1, 1_000_000, 'maxTokens')
  if (options.temperature !== undefined) generationConfig.temperature = boundedNumber(options.temperature, -100, 100, 'temperature')
  if (options.stop !== undefined) generationConfig.stopSequences = options.stop.slice(0, 16).map(item => item.slice(0, 256))
  if (options.reasoningEffort !== undefined) generationConfig.thinkingConfig = { thinkingLevel: String(options.reasoningEffort) }
  if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig
  if (options.tools !== undefined && options.tools.length > 0) {
    const declarations = buildFunctionDeclarations(options.tools)
    if (declarations.length > 0) request.tools = [{ functionDeclarations: declarations }]
  }
  const replay = findReplay(options.messages, options.model)
  if (replay !== undefined) request.replay = replay
  const resolved = resolveModelWithTier(options.model, { cli_first: false })
  const requestedEffort = normalizeReasoningEffort(options.reasoningEffort)
  const thinkingLevel = requestedEffort ?? resolved.thinkingLevel
  if (wireModel.toLowerCase().includes('claude')) {
    applyClaudeTransforms(request, {
      model: wireModel,
      ...(resolved.thinkingBudget === undefined ? {} : { tierThinkingBudget: resolved.thinkingBudget }),
      ...(options.reasoningEffort === undefined && resolved.thinkingBudget === undefined ? {} : { normalizedThinking: { includeThoughts: true, ...(resolved.thinkingBudget === undefined ? {} : { thinkingBudget: resolved.thinkingBudget }) } }),
      cleanJSONSchema: value => isRecord(value) ? value : { type: 'object', properties: {} },
    })
  } else {
    applyGeminiTransforms(request, {
      model: wireModel,
      ...(thinkingLevel === undefined ? {} : { tierThinkingLevel: thinkingLevel as 'low' | 'medium' | 'high' }),
      ...(resolved.thinkingBudget === undefined ? {} : { tierThinkingBudget: resolved.thinkingBudget }),
      ...(options.reasoningEffort === undefined && resolved.thinkingBudget === undefined ? {} : { normalizedThinking: { includeThoughts: true, ...(resolved.thinkingBudget === undefined ? {} : { thinkingBudget: resolved.thinkingBudget }) } }),
    })
  }
  return { project: credential.projectId, model: wireModel, request }
}

function mapMessage(message: Message, model: string): Record<string, unknown> {
  const parts: Record<string, unknown>[] = []
  const replay = compatibleReplayState(message, ANTIGRAVITY_PROVIDER, model, contentKinds(message))
  let replayIndex = 0
  for (const block of message.content) {
    const replayBlock = isReplayBlock(block) ? replay?.blocks[replayIndex++] : undefined
    if (block.type === 'text') {
      parts.push({ text: block.text, ...(replayBlock?.signature === undefined ? {} : { thoughtSignature: replayBlock.signature }) })
    } else if (block.type === 'reasoning') {
      parts.push({ text: block.text, thought: true, ...(replayBlock?.signature === undefined ? {} : { thoughtSignature: replayBlock.signature }) })
    } else if (block.type === 'tool-call') {
      parts.push({
        functionCall: {
          name: block.name,
          args: parseJsonObject(block.arguments),
          ...(replayBlock?.signature === undefined ? {} : { thoughtSignature: replayBlock.signature }),
        },
      })
    } else if (block.type === 'tool-result') {
      parts.push({ functionResponse: { name: 'tool', response: { content: blocksToText(block.content) } } })
    } else if (block.type === 'image') {
      throw new LlmError('Antigravity text requests do not accept unresolved image blocks', 'UNSUPPORTED_MODALITY')
    }
  }
  return {
    role: message.role === 'assistant' ? 'model' : 'user',
    parts,
  }
}

async function mapMessageWithAttachments(
  message: Message,
  model: string,
  attachments: Pick<AttachmentStore, 'readImage'> | undefined,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  if (!message.content.some(block => block.type === 'image')) return mapMessage(message, model)
  if (attachments === undefined) throw new LlmError('Antigravity image input requires the Host AttachmentStore', 'UNSUPPORTED_MODALITY')
  const replay = compatibleReplayState(message, ANTIGRAVITY_PROVIDER, model, contentKinds(message))
  const parts: Record<string, unknown>[] = []
  let replayIndex = 0
  for (const block of message.content) {
    const replayBlock = isReplayBlock(block) ? replay?.blocks[replayIndex++] : undefined
    if (block.type === 'image') {
      const stored = await attachments.readImage(block.attachment, signal)
      parts.push({ inlineData: { mimeType: stored.ref.mediaType, data: Buffer.from(stored.data).toString('base64') } })
    } else if (block.type === 'text') {
      parts.push({ text: block.text, ...(replayBlock?.signature === undefined ? {} : { thoughtSignature: replayBlock.signature }) })
    } else if (block.type === 'reasoning') {
      parts.push({ text: block.text, thought: true, ...(replayBlock?.signature === undefined ? {} : { thoughtSignature: replayBlock.signature }) })
    } else if (block.type === 'tool-call') {
      parts.push({ functionCall: { name: block.name, args: parseJsonObject(block.arguments), ...(replayBlock?.signature === undefined ? {} : { thoughtSignature: replayBlock.signature }) } })
    } else if (block.type === 'tool-result') {
      parts.push({ functionResponse: { name: 'tool', response: { content: blocksToText(block.content) } } })
    }
  }
  return { role: message.role === 'assistant' ? 'model' : 'user', parts }
}

function normalizeReasoningEffort(value: GenerateOptions['reasoningEffort']): string | undefined {
  if (value === undefined) return undefined
  const normalized = String(value).toLowerCase()
  return ['minimal', 'low', 'medium', 'high'].includes(normalized) ? normalized : undefined
}

function resolveWireModel(model: string): string {
  const resolved = resolveModelWithTier(model, { cli_first: false })
  return resolved.actualModel
}

function requestSessionKey(options: GenerateOptions): string {
  return options.sessionId === undefined ? 'default' : `session:${fnv1a64Signed(String(options.sessionId))}`
}

function isReplayBlock(block: Message['content'][number]): boolean {
  return block.type === 'text' || block.type === 'reasoning' || block.type === 'tool-call'
}

function contentKinds(message: Message): Array<'text' | 'reasoning' | 'tool-call'> {
  return message.content.flatMap(block => block.type === 'text' || block.type === 'reasoning' || block.type === 'tool-call' ? [block.type] : [])
}

function findReplay(messages: readonly Message[], model: string): ReplayEnvelope | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant') continue
    const replay = compatibleReplayState(message, ANTIGRAVITY_PROVIDER, model, contentKinds(message))
    if (replay !== undefined) return replay
  }
  return undefined
}

function parseProviderEvent(data: string): ProviderEvent {
  const normalized = data.trim().replace(/^\)\]\}'(?:\r?\n)?/u, '')
  let value: unknown
  try { value = JSON.parse(normalized) as unknown } catch {
    throw new PrivateTransportError('invalid-response', 'The private response contained invalid JSON')
  }
  if (!isRecord(value)) throw new PrivateTransportError('protocol-drift', 'The private response event was not an object')
  if (isRecord(value.error)) return { parts: [], error: errorDetails(value.error) }
  const root = isRecord(value.response) ? value.response : value
  if (isRecord(root.error)) return { parts: [], error: errorDetails(root.error) }
  const partsValue = findParts(root)
  const parts: ProviderPart[] = []
  for (const part of partsValue) {
    const parsed = parsePart(part)
    if (parsed !== undefined) parts.push(parsed)
  }
  const usage = parseUsage(root.usageMetadata ?? value.usageMetadata)
  const finish = findFinish(root)
  return {
    parts,
    ...(usage === undefined ? {} : { usage }),
    ...(finish === undefined ? {} : { finish }),
  }
}

function findParts(value: Record<string, unknown>): unknown[] {
  if (Array.isArray(value.parts)) return value.parts
  if (isRecord(value.content) && Array.isArray(value.content.parts)) return value.content.parts
  if (isRecord(value.modelTurn) && Array.isArray(value.modelTurn.parts)) return value.modelTurn.parts
  if (Array.isArray(value.candidates)) {
    const output: unknown[] = []
    for (const candidate of value.candidates) {
      if (!isRecord(candidate)) continue
      const content = isRecord(candidate.content) ? candidate.content : candidate
      if (Array.isArray(content.parts)) output.push(...content.parts)
    }
    return output
  }
  if (isRecord(value.serverContent) && isRecord(value.serverContent.modelTurn) && Array.isArray(value.serverContent.modelTurn.parts)) {
    return value.serverContent.modelTurn.parts
  }
  return []
}

function parsePart(value: unknown): ProviderPart | undefined {
  if (!isRecord(value)) throw new PrivateTransportError('protocol-drift', 'The private response part was malformed')
  if (typeof value.text === 'string') {
    const kind = value.thought === true || value.reasoning === true || value.thinking === true ? 'reasoning' as const : 'text' as const
    const signature = signatureOf(value)
    return { kind, text: value.text, ...(signature === undefined ? {} : { signature }) }
  }
  const functionCall = isRecord(value.functionCall) ? value.functionCall : isRecord(value.function_call) ? value.function_call : undefined
  if (functionCall !== undefined) {
    const name = stringValue(functionCall.name)
    const id = stringValue(functionCall.id)
    const signature = signatureOf(value)
    const args = typeof functionCall.args === 'string' ? functionCall.args : JSON.stringify(functionCall.args ?? {})
    return {
      kind: 'tool-call',
      ...(name === undefined ? {} : { name }),
      ...(id === undefined ? {} : { id }),
      arguments: args,
      ...(signature === undefined ? {} : { signature }),
    }
  }
  if (value.inlineData !== undefined || value.inline_data !== undefined) {
    throw new PrivateTransportError('protocol-drift', 'The text model returned unsupported media output')
  }
  throw new PrivateTransportError('protocol-drift', 'The private response contained an unknown part type')
}

function errorDetails(value: Record<string, unknown>): NonNullable<ProviderEvent['error']> {
  const status = numberValue(value.status)
  const code = stringValue(value.code)
  return {
    ...(status === undefined ? {} : { status }),
    ...(code === undefined ? {} : { code }),
  }
}

function parseUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined
  const input = numberValue(value.promptTokenCount ?? value.inputTokenCount)
  const output = numberValue(value.candidatesTokenCount ?? value.outputTokenCount)
  const reasoning = numberValue(value.thoughtsTokenCount ?? value.reasoningTokenCount)
  const cached = numberValue(value.cachedContentTokenCount ?? value.cacheReadTokens)
  if (input === undefined && output === undefined && reasoning === undefined && cached === undefined) return undefined
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    ...(cached === undefined ? {} : { cacheReadTokens: cached }),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
  }
}

function findFinish(value: Record<string, unknown>): string | undefined {
  const candidate = value.finishReason ?? value.finish_reason
  if (typeof candidate === 'string') return candidate
  if (isRecord(value.serverContent) && typeof value.serverContent.finishReason === 'string') return value.serverContent.finishReason
  if (Array.isArray(value.candidates)) {
    for (const item of value.candidates) if (isRecord(item) && typeof item.finishReason === 'string') return item.finishReason
  }
  return undefined
}

function signatureOf(value: Record<string, unknown>): string | undefined {
  return stringValue(value.thoughtSignature ?? value.thought_signature ?? value.signature)
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    if (isRecord(parsed)) return parsed
  } catch {
    // The provider must never receive silently rewritten historical tool calls.
  }
  throw new LlmError('The Antigravity tool-call history is malformed', 'PROTOCOL_DRIFT')
}

function blocksToText(blocks: readonly { type: string; text?: string }[]): string {
  return blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n').slice(0, 64 * 1024)
}

function isAuthenticationCode(value: string | undefined): boolean {
  const normalized = value?.toUpperCase()
  return normalized === 'UNAUTHENTICATED' || normalized === 'AUTHENTICATION' || normalized === 'INVALID_GRANT' || normalized === 'UNAUTHENTICATED_REQUEST'
}

function mapFinishReason(value: string | undefined): FinishReason['kind'] {
  const normalized = value?.toUpperCase()
  if (normalized === 'MAX_TOKENS' || normalized === 'LENGTH') return 'max-tokens'
  if (normalized === 'SAFETY' || normalized === 'BLOCKLIST' || normalized === 'ERROR') return 'error'
  if (normalized === 'TOOL_CALLS' || normalized === 'FUNCTION_CALL') return 'tool-calls'
  return 'stop'
}

function finishChunk(
  kind: FinishReason['kind'],
  code: string,
  status?: number,
  replayState?: ReplayEnvelope,
): StreamChunk {
  const reason: FinishReason = kind === 'aborted'
    ? { kind: 'aborted', failure: { code, message: 'The Antigravity request was cancelled' } }
    : kind === 'error'
      ? { kind: 'error', failure: { code, message: 'The Antigravity provider request failed', ...(status === undefined ? {} : { status }) } }
      : kind === 'max-tokens'
        ? { kind: 'max-tokens' }
        : kind === 'tool-calls'
          ? { kind: 'tool-calls' }
          : { kind: 'stop' }
  return { type: 'finish', reason, ...(replayState === undefined ? {} : { replayState }) }
}

function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error
  if (error instanceof PrivateTransportError) {
    const code = error.code === 'authentication' ? 'AUTH'
      : error.code === 'forbidden' ? 'FORBIDDEN'
        : error.code === 'rate-limited' ? 'RATE_LIMIT'
        : error.code === 'cancelled' ? 'CANCELLED'
          : error.code === 'timeout' ? 'TIMEOUT'
            : error.code === 'attribution-rejected' ? 'GATE_0_ATTRIBUTION'
              : error.code === 'protocol-drift' || error.code === 'invalid-response' ? 'PROTOCOL_DRIFT'
                : error.code === 'response-too-large' || error.code === 'frame-too-large' ? 'RESPONSE_LIMIT'
                  : error.code === 'request-too-large' ? 'REQUEST_LIMIT'
                    : error.code === 'upstream' ? 'UPSTREAM'
                      : 'NETWORK'
    return error.status === undefined
      ? new LlmError(error.message, code)
      : new LlmError(error.message, code, { status: error.status })
  }
  if (error instanceof Error) return new LlmError('The Antigravity provider request failed safely', 'PROVIDER_ERROR', { cause: error })
  return new LlmError('The Antigravity provider request failed safely', 'PROVIDER_ERROR')
}

function positive(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? fallback : Math.min(Math.floor(value), 10 * 60 * 1000)
}

function boundedInteger(value: number, min: number, max: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new LlmError(`The Antigravity ${field} option is invalid`, 'INVALID_OPTIONS')
  return value
}

function boundedNumber(value: number, min: number, max: number, field: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new LlmError(`The Antigravity ${field} option is invalid`, 'INVALID_OPTIONS')
  return value
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 16 * 1024 && !hasControl(value) ? value : undefined
}

function hasControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 32 || code === 127) return true
  }
  return false
}

function safeProviderErrorCode(value: string | undefined): string {
  const normalized = value?.toUpperCase()
  return normalized === 'SAFETY' || normalized === 'BLOCKED' || normalized === 'RESOURCE_EXHAUSTED' || normalized === 'INVALID_ARGUMENT'
    ? normalized
    : 'UPSTREAM_ERROR'
}

function safeProviderStatus(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined
}

async function cancelResponse(response: Response): Promise<void> {
  try { await response.body?.cancel() } catch { /* best effort before a bounded replay */ }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
