import { describe, expect, it, vi } from 'vitest'
import {
  createAntigravityAuthRpcClient,
  parseStatusResult,
} from '../src/rpc-contract.ts'
import { handleAntigravityAuthRpc } from '../src/rpc.ts'
import { createBootstrapStatusService } from '../src/status.ts'

const signal = new AbortController().signal

async function request(endpoint: string, payload: unknown) {
  return handleAntigravityAuthRpc(createBootstrapStatusService(), endpoint, payload, signal)
}

describe('Antigravity bootstrap RPC', () => {
  it('returns only value-free plugin and gate status', async () => {
    const result = await request('status', {})

    expect(result).toEqual({
      ok: true,
      value: {
        status: {
          pluginId: 'dsh-antigravity-auth',
          phase: 'bootstrap',
          privateSelfUse: true,
          singleAccount: true,
          riskAcknowledgementRequired: true,
          riskAcknowledged: false,
          capabilities: [
            { id: 'auth-llm', state: 'poc-pending', reasonCode: 'login-not-implemented' },
            { id: 'search', state: 'poc-pending', reasonCode: 'gate-not-run' },
            { id: 'image', state: 'poc-pending', reasonCode: 'gate-not-run' },
            { id: 'video', state: 'poc-pending', reasonCode: 'gate-not-run' },
          ],
        },
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/token|secret|cookie|endpoint/i)
  })

  it('requires a risk acknowledgement before login can begin', async () => {
    const service = createBootstrapStatusService()
    const result = await handleAntigravityAuthRpc(service, 'login', {}, signal)

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'bad-request', message: 'risk acknowledgement is required before login can begin' },
    })
  })

  it('records acknowledgement and keeps the later login gate explicitly pending', async () => {
    const service = createBootstrapStatusService()

    expect(await handleAntigravityAuthRpc(service, 'acknowledge-risk', { acknowledge: true }, signal)).toEqual({
      ok: true,
      value: { acknowledged: true },
    })
    expect(await handleAntigravityAuthRpc(service, 'status', {}, signal)).toMatchObject({
      ok: true,
      value: { status: { riskAcknowledged: true } },
    })
    expect(await handleAntigravityAuthRpc(service, 'login', {}, signal)).toEqual({
      ok: true,
      value: { started: false, reason: 'poc-pending' },
    })
  })

  it('rejects unknown fields and endpoints without echoing caller data', async () => {
    const extra = await request('status', { token: 'should-not-cross' })
    const unknown = await request('private?token=should-not-cross', {})

    expect(extra).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(unknown).toMatchObject({ ok: false, error: { code: 'bad-request', message: 'unknown Antigravity auth endpoint' } })
    expect(JSON.stringify(unknown)).not.toContain('should-not-cross')
  })

  it('returns cancellation before evaluating any operation', async () => {
    const controller = new AbortController()
    controller.abort()
    const service = createBootstrapStatusService()
    const status = vi.spyOn(service, 'status')

    const result = await handleAntigravityAuthRpc(service, 'status', {}, controller.signal)

    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(status).not.toHaveBeenCalled()
  })

  it('validates the browser response as a closed status schema', () => {
    const valid = {
      status: {
        pluginId: 'dsh-antigravity-auth',
        phase: 'bootstrap',
        privateSelfUse: true,
        singleAccount: true,
        riskAcknowledgementRequired: true,
        riskAcknowledged: false,
        capabilities: [
          { id: 'auth-llm', state: 'poc-pending', reasonCode: 'login-not-implemented' },
          { id: 'search', state: 'poc-pending', reasonCode: 'gate-not-run' },
          { id: 'image', state: 'poc-pending', reasonCode: 'gate-not-run' },
          { id: 'video', state: 'poc-pending', reasonCode: 'gate-not-run' },
        ],
      },
    }
    expect(parseStatusResult(valid)).toMatchObject({ pluginId: 'dsh-antigravity-auth' })
    expect(parseStatusResult({ ...valid, leaked: 'value' })).toBeUndefined()
    expect(parseStatusResult({ ...valid, status: { ...valid.status, capabilities: [] } })).toBeUndefined()
  })

  it('keeps the browser face typed and forwards only fixed operations', async () => {
    const status = createBootstrapStatusService().status()
    const rpc = {
      call: vi.fn()
        .mockResolvedValueOnce({ ok: true, value: { status } })
        .mockResolvedValueOnce({ ok: true, value: { acknowledged: true } })
        .mockResolvedValueOnce({ ok: true, value: { started: false, reason: 'poc-pending' } }),
    }
    const client = createAntigravityAuthRpcClient(rpc)

    await client.status()
    await client.acknowledgeRisk()
    await client.login()

    expect(rpc.call.mock.calls.map(call => call.slice(0, 3))).toEqual([
      ['/antigravity-auth', 'status', {}],
      ['/antigravity-auth', 'acknowledge-risk', { acknowledge: true }],
      ['/antigravity-auth', 'login', {}],
    ])
  })
})
