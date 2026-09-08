import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyAuth } from '../src/index.ts'

const contexts: Context[] = []
const tempDirs: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    await ctx.fiber.dispose()
  }
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * Mount a real Cordis composition for the intended terminal profile: real
 * SessionStore + CommandRuntime, the plugin applied, and NO WebServer or
 * `connection` service. Commands dispatch through the real command runtime.
 */
async function mountTerminal(): Promise<{ ctx: Context; agent: Agent }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-antigravity-terminal-'))
  tempDirs.push(root)
  const previousDataHome = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = root
  const ctx = new Context()
  contexts.push(ctx)
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    applyAuth(ctx)
    await new Promise<void>(resolve => setImmediate(resolve))
    const session = ctx.sessions.create(SessionId('antigravity-auth-terminal'))
    const agent = { id: session.id, session } as unknown as Agent
    return { ctx, agent }
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previousDataHome
  }
}

describe('antigravity-auth slash command on a terminal composition (no WebServer/connection)', () => {
  it('dispatches status through the real command runtime to the shared auth service', async () => {
    const { ctx, agent } = await mountTerminal()

    const execution = await ctx.commands.execute(agent, '/antigravity-auth status', [], new AbortController().signal)

    expect(execution?.result.kind).toBe('success')
    if (execution?.result.kind === 'success') {
      expect(execution.result.text).toContain('Antigravity auth:')
      expect(execution.result.text).not.toContain('require a local DSH Host')
    }
  })

  it('dispatches cancel through the real command runtime into the shared auth service', async () => {
    const { ctx, agent } = await mountTerminal()

    const execution = await ctx.commands.execute(agent, '/antigravity-auth cancel', [], new AbortController().signal)

    // No authorization is pending on this fresh store, so the shared service
    // reports the idle phase; the text proves the handler reached the service
    // instead of the composition denial gate.
    expect(execution?.result.kind).toBe('error')
    if (execution?.result.kind === 'error') {
      expect(execution.result.text).toContain('could not be cancelled')
      expect(execution.result.text).not.toContain('require a local DSH Host')
    }
  })
})
