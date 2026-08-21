// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AntigravityAuthSettings } from '../src/client/AntigravityAuthSettings.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { AntigravityAuthRpcClient } from '../src/rpc-contract.ts'
import { createBootstrapStatusService } from '../src/status.ts'

function rpcFixture(): AntigravityAuthRpcClient {
  const status = createBootstrapStatusService().status()
  return {
    status: vi.fn().mockResolvedValue({ ok: true, value: { status } }),
    acknowledgeRisk: vi.fn().mockResolvedValue({ ok: true, value: { acknowledged: true } }),
    login: vi.fn().mockResolvedValue({ ok: true, value: { started: false, reason: 'poc-pending' } }),
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Antigravity bootstrap settings', () => {
  it('requires risk acknowledgement before login and exposes gate status without secret controls', async () => {
    const rpc = rpcFixture()
    const unsubscribe = vi.fn()
    const { unmount } = render(
      <AntigravityAuthSettings rpc={rpc} t={key => en[key]} subscribe={() => unsubscribe} />,
    )

    expect(await screen.findByRole('heading', { name: 'Unofficial / Experimental' })).toBeTruthy()
    expect(screen.getByText(/Google does not support third-party/i)).toBeTruthy()
    expect(screen.getByText(/Single-account only/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.loginUnavailable })).toHaveProperty('disabled', true)
    expect(screen.getAllByText('POC pending')).toHaveLength(4)
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.queryByLabelText(/token|client secret|endpoint/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /add|switch|rotate/i })).toBeNull()

    const acknowledgement = screen.getByRole('checkbox', { name: en.riskAcknowledgement })
    fireEvent.click(acknowledgement)
    await waitFor(() => expect(rpc.acknowledgeRisk).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: en.loginUnavailable })).toHaveProperty('disabled', true)
    expect(screen.getByText(en.loginPending)).toBeTruthy()
    expect(rpc.login).not.toHaveBeenCalled()

    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('renders the same status shell with Chinese copy', async () => {
    const rpc = rpcFixture()
    render(<AntigravityAuthSettings rpc={rpc} t={key => zh[key]} subscribe={() => () => {}} />)

    expect(await screen.findByRole('heading', { name: '非官方 / 实验性' })).toBeTruthy()
    expect(screen.getByText(/Google 不支持第三方/i)).toBeTruthy()
    expect(screen.getAllByText('POC 待验证')).toHaveLength(4)
  })

  it('aborts an in-flight status read and unsubscribes on unmount', async () => {
    let signal: AbortSignal | undefined
    const status = vi.fn((_candidate?: AbortSignal) => {
      signal = _candidate
      return new Promise<never>(() => {})
    })
    const unsubscribe = vi.fn()
    const { unmount } = render(
      <AntigravityAuthSettings
        rpc={{ status, acknowledgeRisk: vi.fn(), login: vi.fn() } as unknown as AntigravityAuthRpcClient}
        t={key => en[key]}
        subscribe={() => unsubscribe}
      />,
    )

    await waitFor(() => expect(signal).toBeDefined())
    unmount()
    expect(signal?.aborted).toBe(true)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
