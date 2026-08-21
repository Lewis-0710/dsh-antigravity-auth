import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthStoreError, createAuthStore, defaultAuthStorePath } from '../src/auth-store.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function storeFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-antigravity-auth-'))
  directories.push(directory)
  return { directory, path: join(directory, 'nested', 'auth.json') }
}

describe('single-account Antigravity auth store', () => {
  it('uses the Windows local application-data path when running on Windows', () => {
    expect(defaultAuthStorePath({ LOCALAPPDATA: '/user/local-app-data' }, undefined, 'win32'))
      .toBe(join('/user/local-app-data', 'dsh-antigravity-auth', 'auth.json'))
  })

  it('commits a versioned record atomically with owner-only permissions and no access token', async () => {
    const { directory, path } = await storeFixture()
    const store = createAuthStore(path, { now: () => 1_000 })

    const record = await store.compareAndCommit(0, {
      refreshToken: 'refresh-secret',
      projectId: 'project-1',
      email: 'a***@example.com',
      accessToken: 'must-not-persist',
    } as never)

    expect(record).toMatchObject({ version: 1, refreshToken: 'refresh-secret', projectId: 'project-1', revision: 1 })
    expect(JSON.stringify(await store.read())).not.toContain('must-not-persist')
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain('refresh-secret')
    expect(raw).not.toContain('accessToken')
    expect(await readdir(directory)).toEqual(['nested'])
    if (process.platform !== 'win32') {
      expect((await stat(join(directory, 'nested'))).mode & 0o777).toBe(0o700)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    }
    expect((await readdir(join(directory, 'nested'))).filter(name => name.includes('.bak'))).toEqual([])
  })

  it('detects corruption and rejects stale revision commits without replacing the current account', async () => {
    const { path } = await storeFixture()
    const store = createAuthStore(path, { now: () => 2_000 })
    await store.commit({ refreshToken: 'refresh-1', projectId: 'project-1' })

    expect(await store.compareAndCommit(0, { refreshToken: 'refresh-2', projectId: 'project-2' })).toBeUndefined()
    expect((await store.read())?.refreshToken).toBe('refresh-1')

    await writeFile(path, '{not-json', 'utf8')
    await expect(store.read()).rejects.toMatchObject({ code: 'AUTH_STORE_CORRUPT' })
  })

  it('clears the one account without treating an absent file as corruption', async () => {
    const { path } = await storeFixture()
    const store = createAuthStore(path)
    await store.clear()
    expect(await store.read()).toBeUndefined()
    await store.commit({ refreshToken: 'refresh-1', projectId: 'project-1' })
    await store.clear()
    expect(await store.read()).toBeUndefined()
  })

  it('does not expose raw filesystem or credential values in store errors', async () => {
    const { path } = await storeFixture()
    const store = createAuthStore(path)
    await store.commit({ refreshToken: 'refresh-secret', projectId: 'project-1' })
    await writeFile(path, JSON.stringify({ version: 999, refreshToken: 'secret-value' }), 'utf8')
    try {
      await store.read()
      expect.fail('expected unsupported version')
    } catch (error) {
      expect(error).toBeInstanceOf(AuthStoreError)
      expect(String(error)).not.toContain('secret-value')
      expect(String(error)).not.toContain(path)
    }
  })
})
