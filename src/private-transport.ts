/** Bounded Host-only transport primitives for the private Antigravity endpoints. */

import {
  ANTIGRAVITY_WIRE_ORIGIN,
  createWireIdentity,
  type WireIdentity,
} from './wire-identity.ts'

export const DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS = 15_000
export const DEFAULT_PRIVATE_IDLE_TIMEOUT_MS = 30_000
export const DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS = 120_000
export const DEFAULT_PRIVATE_RESPONSE_BYTES = 8 * 1024 * 1024
export const DEFAULT_PRIVATE_REQUEST_BYTES = 16 * 1024 * 1024
export const DEFAULT_PRIVATE_FRAME_BYTES = 512 * 1024

const OMIT_FRAMING_HEADERS = new Set(['host', 'content-length', 'transfer-encoding'])

export type PrivateTransportErrorCode =
  | 'authentication'
  | 'forbidden'
  | 'rate-limited'
  | 'timeout'
  | 'offline'
  | 'cancelled'
  | 'response-too-large'
  | 'request-too-large'
  | 'frame-too-large'
  | 'invalid-response'
  | 'protocol-drift'
  | 'upstream'
  | 'attribution-rejected'

export class PrivateTransportError extends Error {
  readonly code: PrivateTransportErrorCode
  readonly status?: number
  /** Whether an upstream could have accepted the generation request. */
  readonly accepted: boolean

  constructor(
    code: PrivateTransportErrorCode,
    message: string,
    options: { readonly status?: number; readonly accepted?: boolean } = {},
  ) {
    super(message)
    this.name = 'PrivateTransportError'
    this.code = code
    this.accepted = options.accepted ?? true
    if (options.status === undefined) return
    this.status = options.status
  }
}

export interface PrivateTransportRequest {
  readonly url: string
  readonly accessToken: string
  readonly body: string | Uint8Array
  readonly signal?: AbortSignal
  readonly responseHeaderTimeoutMs?: number
}

export interface PrivateTransportOptions {
  readonly fetchImpl?: typeof fetch
  readonly wireIdentity?: WireIdentity
  readonly responseHeaderTimeoutMs?: number
  readonly maxRequestBytes?: number
}

export interface PrivateTransport {
  request(input: PrivateTransportRequest): Promise<Response>
}

/** Build one fixed private request transport. Callers cannot supply headers or origins. */
export function createPrivateTransport(options: PrivateTransportOptions = {}): PrivateTransport {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const wire = options.wireIdentity ?? createWireIdentity()
  const headerTimeoutMs = boundedTimeout(options.responseHeaderTimeoutMs, DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS)

  return {
    request: async input => {
      if (isAborted(input.signal)) throw cancelledError()
      const maxRequestBytes = boundedPositive(options.maxRequestBytes, DEFAULT_PRIVATE_REQUEST_BYTES)
      const requestBytes = typeof input.body === 'string' ? new TextEncoder().encode(input.body).byteLength : input.body.byteLength
      if (requestBytes > maxRequestBytes) throw new PrivateTransportError('request-too-large', 'The private request exceeded the byte limit', { accepted: false })
      const requestController = new AbortController()
      const removeAbort = forwardAbort(input.signal, requestController)
      const timeout = boundedTimeout(input.responseHeaderTimeoutMs, headerTimeoutMs)
      let timer: ReturnType<typeof setTimeout> | undefined
      let timedOut = false
      const body = typeof input.body === 'string' ? input.body : input.body
      let headers: Record<string, string>
      try {
        const identityHeaders = wire.headers()
        const pairs = wire.headerPairs(input.url, {
          authorization: `Bearer ${input.accessToken}`,
          body,
        })
        headers = {}
        for (const [name, value] of pairs) {
          if (OMIT_FRAMING_HEADERS.has(name.toLowerCase())) continue
          headers[name] = value
        }
        const bearer = headers.Authorization ?? headers.authorization
        if (typeof bearer !== 'string') throw new PrivateTransportError('protocol-drift', 'The private identity did not produce authorization')
        for (const name of ['User-Agent', 'X-Goog-Api-Client', 'Client-Metadata', 'X-DeepSeek-Harness-Attribution']) {
          const expected = identityHeaders[name as keyof typeof identityHeaders]
          if (typeof expected !== 'string' || headers[name] !== expected) throw new PrivateTransportError('protocol-drift', 'The private identity omitted a mandatory carrier')
        }
      } catch (error) {
        removeAbort()
        if (error instanceof PrivateTransportError) throw error
        throw new PrivateTransportError('attribution-rejected', 'The private request identity was rejected')
      }

      const request = Promise.resolve().then(() => fetchImpl(input.url, {
        method: 'POST',
        headers,
        body: body as unknown as BodyInit,
        signal: requestController.signal,
      }))
      request.catch(() => {})
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true
            requestController.abort()
            reject(new PrivateTransportError('timeout', 'The private request timed out before response headers', { accepted: false }))
          }, timeout)
        })
        const response = await Promise.race([request, timeoutPromise])
        if (!(response instanceof Response)) {
          throw new PrivateTransportError('invalid-response', 'The private endpoint returned no response')
        }
        return response
      } catch (error) {
        if (error instanceof PrivateTransportError) throw error
        if (isAborted(input.signal)) throw cancelledError()
        if (timedOut) throw new PrivateTransportError('timeout', 'The private request timed out', { accepted: false })
        throw new PrivateTransportError('offline', 'The private endpoint could not be reached', { accepted: false })
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        removeAbort()
      }
    },
  }
}

/** Convert a bounded response status to a safe provider error without exposing its body. */
export function privateStatusError(status: number): PrivateTransportError | undefined {
  if (status >= 200 && status < 300) return undefined
  if (status === 401) return new PrivateTransportError('authentication', 'The private endpoint requires authentication', { status })
  if (status === 403) return new PrivateTransportError('forbidden', 'The private endpoint forbade this account', { status })
  if (status === 429) return new PrivateTransportError('rate-limited', 'The private endpoint is rate-limited', { status })
  if (status >= 500) return new PrivateTransportError('upstream', 'The private endpoint is unavailable', { status })
  return new PrivateTransportError('protocol-drift', 'The private endpoint returned an unexpected status', { status })
}

export interface BoundedReadOptions {
  readonly signal?: AbortSignal
  readonly idleTimeoutMs?: number
  readonly totalTimeoutMs?: number
  readonly maxBytes?: number
}

/** Read a response body with byte, idle, total, and cancellation bounds. */
export async function readPrivateBytes(response: Response, options: BoundedReadOptions = {}): Promise<Uint8Array> {
  const maxBytes = boundedPositive(options.maxBytes, DEFAULT_PRIVATE_RESPONSE_BYTES)
  if (response.body === null) {
    try {
      const data = new Uint8Array(await response.arrayBuffer())
      if (data.byteLength > maxBytes) throw new PrivateTransportError('response-too-large', 'The private response exceeded the byte limit')
      return data
    } catch (error) {
      if (error instanceof PrivateTransportError) throw error
      if (isAborted(options.signal)) throw cancelledError()
      throw new PrivateTransportError('offline', 'The private response body could not be read')
    }
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  const startedAt = Date.now()
  try {
    for (;;) {
      const chunk = await readChunk(reader, options, startedAt)
      if (chunk.done) break
      const value = chunk.value
      total += value.byteLength
      if (total > maxBytes) {
        await cancelReader(reader)
        throw new PrivateTransportError('response-too-large', 'The private response exceeded the byte limit')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof PrivateTransportError) throw error
    if (isAborted(options.signal)) throw cancelledError()
    throw new PrivateTransportError('offline', 'The private response body could not be read')
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export async function readPrivateText(response: Response, options: BoundedReadOptions = {}): Promise<string> {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(await readPrivateBytes(response, options))
  } catch (error) {
    if (error instanceof PrivateTransportError) throw error
    throw new PrivateTransportError('invalid-response', 'The private response was not valid UTF-8')
  }
}

export interface PrivateSseEvent {
  readonly data: string
  readonly event?: string
}

/** Parse SSE/JSON responses without retaining unbounded provider frames. */
export async function* iteratePrivateSse(
  response: Response,
  options: BoundedReadOptions & { readonly maxFrameBytes?: number } = {},
): AsyncGenerator<PrivateSseEvent> {
  const maxBytes = boundedPositive(options.maxBytes, DEFAULT_PRIVATE_RESPONSE_BYTES)
  const maxFrameBytes = boundedPositive(options.maxFrameBytes, DEFAULT_PRIVATE_FRAME_BYTES)
  if (response.body === null) {
    const text = await readPrivateText(response, options)
    if (text.trim().length > 0) yield { data: text.trim() }
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  let eventName: string | undefined
  let dataLines: string[] = []
  let bytes = 0
  let frameBytes = 0
  let sawSseFrame = false
  let plainText = ''
  const startedAt = Date.now()
  const flush = (): PrivateSseEvent | undefined => {
    if (dataLines.length === 0) {
      eventName = undefined
      frameBytes = 0
      return undefined
    }
    const data = dataLines.join('\n')
    const event = eventName
    dataLines = []
    eventName = undefined
    frameBytes = 0
    sawSseFrame = true
    return event === undefined ? { data } : { data, event }
  }

  try {
    for (;;) {
      const chunk = await readChunk(reader, options, startedAt)
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) throw new PrivateTransportError('response-too-large', 'The private response exceeded the byte limit')
      let decoded: string
      try { decoded = decoder.decode(chunk.value, { stream: true }) } catch { throw new PrivateTransportError('invalid-response', 'The private response was not valid UTF-8') }
      plainText += decoded
      buffer += decoded
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) break
        let line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (line.length > maxFrameBytes) throw new PrivateTransportError('frame-too-large', 'The private response frame exceeded the byte limit')
        if (line.length === 0) {
          const event = flush()
          if (event !== undefined) yield event
          continue
        }
        if (line.startsWith(':')) continue
        if (line.startsWith('event:')) {
          eventName = line.slice('event:'.length).trim() || undefined
          frameBytes += line.length
        } else if (line.startsWith('data:')) {
          const value = line.slice('data:'.length).replace(/^ /u, '')
          frameBytes += value.length
          if (frameBytes > maxFrameBytes) throw new PrivateTransportError('frame-too-large', 'The private response frame exceeded the byte limit')
          dataLines.push(value)
        }
      }
    }
    let tail: string
    try { tail = decoder.decode() } catch { throw new PrivateTransportError('invalid-response', 'The private response was not valid UTF-8') }
    plainText += tail
    buffer += tail
    if (buffer.length > 0) {
      if (buffer.length > maxFrameBytes) throw new PrivateTransportError('frame-too-large', 'The private response frame exceeded the byte limit')
      if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).replace(/^ /u, ''))
    }
    const event = flush()
    if (event !== undefined) yield event
    if (!sawSseFrame && plainText.trim().length > 0) yield { data: plainText.trim() }
  } catch (error) {
    if (error instanceof PrivateTransportError) throw error
    if (isAborted(options.signal)) throw cancelledError()
    throw new PrivateTransportError('offline', 'The private response stream could not be read')
  } finally {
    await cancelReader(reader)
    reader.releaseLock()
  }
}

export function assertPrivateEndpoint(url: string): void {
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new PrivateTransportError('protocol-drift', 'The private endpoint URL is invalid') }
  if (parsed.origin !== ANTIGRAVITY_WIRE_ORIGIN || parsed.protocol !== 'https:' || parsed.search || parsed.hash) {
    throw new PrivateTransportError('protocol-drift', 'The private endpoint URL is not allowlisted')
  }
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: BoundedReadOptions,
  startedAt: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (isAborted(options.signal)) {
    await cancelReader(reader)
    throw cancelledError()
  }
  const totalTimeout = boundedPositive(options.totalTimeoutMs, DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS)
  const elapsed = Date.now() - startedAt
  if (elapsed >= totalTimeout) {
    await cancelReader(reader)
    throw new PrivateTransportError('timeout', 'The private response exceeded the total timeout')
  }
  const idleTimeout = boundedPositive(options.idleTimeoutMs, DEFAULT_PRIVATE_IDLE_TIMEOUT_MS)
  let timer: ReturnType<typeof setTimeout> | undefined
  let removeAbort: (() => void) | undefined
  const abort = new Promise<never>((_, reject) => {
    const onAbort = (): void => reject(cancelledError())
    removeAbort = () => options.signal?.removeEventListener('abort', onAbort)
    if (options.signal === undefined) return
    if (options.signal.aborted) onAbort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  })
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PrivateTransportError('timeout', 'The private response stream stalled')), idleTimeout)
  })
  let totalHandle: ReturnType<typeof setTimeout> | undefined
  const remaining = totalTimeout - elapsed
  const total = new Promise<never>((_, reject) => {
    totalHandle = setTimeout(() => reject(new PrivateTransportError('timeout', 'The private response exceeded the total timeout')), remaining)
  })
  try {
    return await Promise.race([reader.read(), abort, idle, total])
  } catch (error) {
    await cancelReader(reader)
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (totalHandle !== undefined) clearTimeout(totalHandle)
    removeAbort?.()
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted
}

function forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (signal === undefined) return () => {}
  const abort = (): void => { if (!controller.signal.aborted) controller.abort(signal.reason) }
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  return () => signal.removeEventListener('abort', abort)
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try { await reader.cancel() } catch { /* best effort */ }
}

function cancelledError(): PrivateTransportError {
  return new PrivateTransportError('cancelled', 'The private request was cancelled')
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? fallback : Math.min(Math.floor(value), 10 * 60 * 1000)
}

function boundedPositive(value: number | undefined, fallback: number): number {
  return boundedTimeout(value, fallback)
}
