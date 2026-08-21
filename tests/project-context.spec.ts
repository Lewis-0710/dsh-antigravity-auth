import { describe, expect, it, vi } from 'vitest'
import {
  DSH_ATTRIBUTION_HEADER,
  type WireIdentity,
} from '../src/wire-identity.ts'
import {
  PROJECT_DISCOVERY_ENDPOINT,
  ProjectDiscoveryError,
  createProjectDiscovery,
} from '../src/project-context.ts'

function wireFixture(): WireIdentity {
  return {
    headers: () => ({
      'User-Agent': 'agy-user-agent',
      'X-Goog-Api-Client': 'agy-client',
      'Client-Metadata': 'agy-metadata',
      [DSH_ATTRIBUTION_HEADER]: 'deepseek-harness/test',
    }),
    headerPairs: vi.fn((_url, request): readonly [string, string][] => [
      ['Host', 'daily-cloudcode-pa.googleapis.com'],
      ['User-Agent', 'agy-user-agent'],
      ['X-Goog-Api-Client', 'agy-client'],
      ['Client-Metadata', 'agy-metadata'],
      [DSH_ATTRIBUTION_HEADER, 'deepseek-harness/test'],
      ['Authorization', request.authorization],
      ['Content-Type', 'application/json'],
      ['Content-Length', String(typeof request.body === 'string' ? request.body.length : request.body.byteLength)],
    ]),
  }
}

function response(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('read-only Antigravity project discovery', () => {
  it('uses the fixed loadCodeAssist request and stores only a normalized project id', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({
      cloudaicompanionProject: { id: ' project-123 ' },
      currentTier: { id: 'private-tier' },
      rawProviderField: 'must-not-cross-the-boundary',
    }))
    const fetchImpl = fetchMock as typeof fetch
    const wire = wireFixture()
    const discovery = createProjectDiscovery({ fetchImpl, wireIdentity: wire })

    await expect(discovery.discover('access-secret')).resolves.toEqual({ projectId: 'project-123' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(PROJECT_DISCOVERY_ENDPOINT)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer access-secret',
      'User-Agent': 'agy-user-agent',
      [DSH_ATTRIBUTION_HEADER]: 'deepseek-harness/test',
    })
    const requestBody = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(requestBody).toEqual({ metadata: { ideType: 'ANTIGRAVITY' } })
    expect(String(init.body)).not.toContain('onboardUser')
    expect(String(init.body)).not.toContain('rising-fact-p41fc')
  })

  it('returns project-unavailable for an otherwise valid response without a project', async () => {
    const fetchImpl = vi.fn(async () => response({ currentTier: { id: 'free' } }))
    const discovery = createProjectDiscovery({ fetchImpl, wireIdentity: wireFixture() })

    await expect(discovery.discover('access-secret')).resolves.toBeUndefined()
  })

  it.each([
    [401, 'authentication'],
    [403, 'forbidden'],
    [429, 'rate-limited'],
    [500, 'offline'],
    [504, 'offline'],
    [404, 'protocol-drift'],
  ] as const)('maps HTTP %s to the safe project state %s', async (status, code) => {
    const fetchImpl = vi.fn(async () => new Response('provider-secret-body', { status }))
    const discovery = createProjectDiscovery({ fetchImpl, wireIdentity: wireFixture() })

    await expect(discovery.discover('access-secret')).rejects.toMatchObject({ code })
    await expect(discovery.discover('access-secret')).rejects.not.toThrow(/provider-secret-body|access-secret/u)
  })

  it('distinguishes malformed JSON from protocol drift without exposing the response', async () => {
    const malformed = createProjectDiscovery({
      fetchImpl: vi.fn(async () => new Response('not-json')),
      wireIdentity: wireFixture(),
    })
    await expect(malformed.discover('access-secret')).rejects.toMatchObject({ code: 'malformed' })

    const drift = createProjectDiscovery({
      fetchImpl: vi.fn(async () => response({ cloudaicompanionProject: { id: 42, secret: 'provider-secret' } })),
      wireIdentity: wireFixture(),
    })
    await expect(drift.discover('access-secret')).rejects.toMatchObject({ code: 'protocol-drift' })
    await expect(drift.discover('access-secret')).rejects.not.toThrow(/provider-secret|access-secret/u)
  })

  it('fails closed when the centralized identity seam rejects the request', async () => {
    const fetchImpl = vi.fn()
    const wire = wireFixture()
    wire.headerPairs = vi.fn((): readonly [string, string][] => { throw new Error('unsafe identity') })
    const discovery = createProjectDiscovery({ fetchImpl, wireIdentity: wire })

    await expect(discovery.discover('access-secret')).rejects.toBeInstanceOf(ProjectDiscoveryError)
    await expect(discovery.discover('access-secret')).rejects.toMatchObject({ code: 'protocol-drift' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
