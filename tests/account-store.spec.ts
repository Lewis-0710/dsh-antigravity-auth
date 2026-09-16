import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createAccountStore, findMatchingAccount } from '../src/account-store.ts'

describe('account-store', () => {
  it('seeds from auth.json when accounts.json is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anti-acc-test-'))
    const authPath = join(dir, 'auth.json')
    const accPath = join(dir, 'accounts.json')

    await writeFile(
      authPath,
      JSON.stringify({
        version: 1,
        refreshToken: 'rt_initial_123',
        projectId: 'proj-1',
        email: 'alice@example.com',
        revision: 1,
        updatedAt: '2026-09-16T00:00:00.000Z',
      }),
      'utf8',
    )

    const store = createAccountStore(accPath, authPath)
    const data = await store.read()

    expect(data.version).toBe(1)
    expect(data.activeId).toBe('acc_1')
    expect(data.accounts).toHaveLength(1)
    expect(data.accounts[0]?.email).toBe('alice@example.com')
    expect(data.accounts[0]?.projectId).toBe('proj-1')
    expect(data.accounts[0]?.refreshToken).toBe('rt_initial_123')
  })

  it('saves multiple accounts and tracks the active account', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anti-acc-test-'))
    const authPath = join(dir, 'auth.json')
    const accPath = join(dir, 'accounts.json')

    const store = createAccountStore(accPath, authPath)

    // Save account 1
    const res1 = await store.saveAccount({
      email: 'alice@example.com',
      projectId: 'proj-alice',
      refreshToken: 'token-alice',
    })
    expect(res1.isNew).toBe(true)
    expect(res1.activeId).toBe('acc_1')

    // Save account 2
    const res2 = await store.saveAccount({
      email: 'bob@example.com',
      projectId: 'proj-bob',
      refreshToken: 'token-bob',
    })
    expect(res2.isNew).toBe(true)
    expect(res2.activeId).toBe('acc_2')

    const list = await store.list()
    expect(list.accounts).toHaveLength(2)
    expect(list.activeId).toBe('acc_2')
    expect(list.accounts[0]?.isActive).toBe(false)
    expect(list.accounts[1]?.isActive).toBe(true)

    // Switch back to account 1 by index '1'
    const switched1 = await store.setActive('1')
    expect(switched1?.email).toBe('alice@example.com')
    expect((await store.read()).activeId).toBe('acc_1')

    // Switch to account 2 by email 'bob'
    const switched2 = await store.setActive('bob')
    expect(switched2?.email).toBe('bob@example.com')
    expect((await store.read()).activeId).toBe('acc_2')
  })

  it('updates existing account on re-login with same email', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anti-acc-test-'))
    const authPath = join(dir, 'auth.json')
    const accPath = join(dir, 'accounts.json')

    const store = createAccountStore(accPath, authPath)

    await store.saveAccount({
      email: 'alice@example.com',
      projectId: 'proj-1',
      refreshToken: 'token-old',
    })

    const res = await store.saveAccount({
      email: 'alice@example.com',
      projectId: 'proj-updated',
      refreshToken: 'token-new',
    })

    expect(res.isNew).toBe(false)
    const list = await store.list()
    expect(list.accounts).toHaveLength(1)
    expect(list.accounts[0]?.refreshToken).toBe('token-new')
    expect(list.accounts[0]?.projectId).toBe('proj-updated')
  })

  it('removes an account and falls back to remaining account', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anti-acc-test-'))
    const authPath = join(dir, 'auth.json')
    const accPath = join(dir, 'accounts.json')

    const store = createAccountStore(accPath, authPath)

    await store.saveAccount({ email: 'a@example.com', projectId: 'p1', refreshToken: 't1' })
    await store.saveAccount({ email: 'b@example.com', projectId: 'p2', refreshToken: 't2' })

    expect((await store.read()).activeId).toBe('acc_2')

    // Remove active account '2'
    const removed = await store.removeAccount('2')
    expect(removed?.email).toBe('b@example.com')

    const data = await store.read()
    expect(data.accounts).toHaveLength(1)
    expect(data.activeId).toBe('acc_1')
  })
})

describe('findMatchingAccount', () => {
  const accounts = [
    { id: 'acc_1', email: 'alice@gmail.com', maskedEmail: 'a***@gmail.com', projectId: 'p1', refreshToken: 't1', updatedAt: '' },
    { id: 'acc_2', email: 'bob@company.com', maskedEmail: 'b***@company.com', projectId: 'p2', refreshToken: 't2', updatedAt: '' },
  ]

  it('matches by 1-based index', () => {
    expect(findMatchingAccount(accounts, '1')?.account.id).toBe('acc_1')
    expect(findMatchingAccount(accounts, '2')?.account.id).toBe('acc_2')
    expect(findMatchingAccount(accounts, '3')).toBeUndefined()
  })

  it('matches by exact id', () => {
    expect(findMatchingAccount(accounts, 'acc_2')?.account.email).toBe('bob@company.com')
  })

  it('matches by email or prefix', () => {
    expect(findMatchingAccount(accounts, 'alice@gmail.com')?.account.id).toBe('acc_1')
    expect(findMatchingAccount(accounts, 'bob')?.account.id).toBe('acc_2')
    expect(findMatchingAccount(accounts, 'unknown')).toBeUndefined()
  })
})
