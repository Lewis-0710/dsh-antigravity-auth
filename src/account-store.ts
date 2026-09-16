/** Owner-only, versioned, multi-account persistence for Google Antigravity. */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { maskEmail } from './auth-service.ts'

export const ACCOUNTS_RECORD_VERSION = 1 as const

export interface CachedAccount {
  readonly id: string
  readonly email?: string | undefined
  readonly maskedEmail?: string | undefined
  readonly projectId: string
  readonly refreshToken: string
  readonly updatedAt: string
  readonly lineage?: string | undefined
}

export interface AccountsData {
  readonly version: typeof ACCOUNTS_RECORD_VERSION
  readonly activeId: string | undefined
  readonly accounts: readonly CachedAccount[]
}

export interface AccountStoreOptions {
  readonly now?: () => number
  readonly platform?: NodeJS.Platform
}

export interface AntigravityAccountStore {
  readonly path: string
  read(): Promise<AccountsData>
  saveAccount(draft: {
    readonly email?: string | undefined
    readonly projectId: string
    readonly refreshToken: string
    readonly updatedAt?: string | undefined
    readonly lineage?: string | undefined
    readonly id?: string | undefined
  }): Promise<{ activeId: string; account: CachedAccount; isNew: boolean }>
  setActive(idOrEmailOrIndex: string): Promise<CachedAccount | undefined>
  removeAccount(idOrEmailOrIndex: string): Promise<CachedAccount | undefined>
  list(): Promise<{ activeId: string | undefined; accounts: readonly (CachedAccount & { isActive: boolean; index: number })[] }>
}

/** Resolve the companion accounts.json path next to auth.json. */
export function defaultAccountStorePath(authStorePath: string): string {
  return join(dirname(authStorePath), 'accounts.json')
}

function normalizeKey(str: string): string {
  return str.trim().toLowerCase()
}

/** Match an account by 1-based index, id, or email (exact or prefix). */
export function findMatchingAccount(
  accounts: readonly CachedAccount[],
  query: string,
): { account: CachedAccount; index: number } | undefined {
  const trimmed = query.trim()
  if (trimmed.length === 0) return undefined

  // 1. Try 1-based index (e.g. "1", "2")
  const num = Number(trimmed)
  if (Number.isSafeInteger(num) && num >= 1 && num <= accounts.length) {
    const acc = accounts[num - 1]
    if (acc !== undefined) return { account: acc, index: num }
  }

  const needle = normalizeKey(trimmed)

  // 2. Exact match on id
  const byIdIndex = accounts.findIndex(a => normalizeKey(a.id) === needle)
  if (byIdIndex >= 0) {
    const acc = accounts[byIdIndex]
    if (acc !== undefined) return { account: acc, index: byIdIndex + 1 }
  }

  // 3. Exact match on email
  const byEmailIndex = accounts.findIndex(a => a.email !== undefined && normalizeKey(a.email) === needle)
  if (byEmailIndex >= 0) {
    const acc = accounts[byEmailIndex]
    if (acc !== undefined) return { account: acc, index: byEmailIndex + 1 }
  }

  // 4. Substring / prefix match on email or maskedEmail
  const byFuzzyIndex = accounts.findIndex(a => {
    if (a.email !== undefined && normalizeKey(a.email).includes(needle)) return true
    if (a.maskedEmail !== undefined && normalizeKey(a.maskedEmail).includes(needle)) return true
    return false
  })
  if (byFuzzyIndex >= 0) {
    const acc = accounts[byFuzzyIndex]
    if (acc !== undefined) return { account: acc, index: byFuzzyIndex + 1 }
  }

  return undefined
}

/** Create the multi-account store managing accounts.json. */
export function createAccountStore(
  accountsPath: string,
  authStorePath: string,
  options: AccountStoreOptions = {},
): AntigravityAccountStore {
  const platform = options.platform ?? process.platform

  async function readRaw(): Promise<AccountsData> {
    try {
      const text = await readFile(accountsPath, 'utf8')
      const parsed = JSON.parse(text) as unknown
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as { version?: number }).version === ACCOUNTS_RECORD_VERSION &&
        Array.isArray((parsed as { accounts?: unknown }).accounts)
      ) {
        const rawAccounts = (parsed as { accounts: unknown[] }).accounts
        const accounts: CachedAccount[] = []
        for (const item of rawAccounts) {
          if (typeof item === 'object' && item !== null) {
            const rec = item as Record<string, unknown>
            if (
              typeof rec.id === 'string' &&
              typeof rec.projectId === 'string' &&
              typeof rec.refreshToken === 'string'
            ) {
              accounts.push({
                id: rec.id,
                email: typeof rec.email === 'string' ? rec.email : undefined,
                maskedEmail: typeof rec.maskedEmail === 'string' ? rec.maskedEmail : maskEmail(typeof rec.email === 'string' ? rec.email : undefined),
                projectId: rec.projectId,
                refreshToken: rec.refreshToken,
                updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : new Date().toISOString(),
                lineage: typeof rec.lineage === 'string' ? rec.lineage : undefined,
              })
            }
          }
        }
        const activeId = typeof (parsed as { activeId?: unknown }).activeId === 'string'
          ? (parsed as { activeId: string }).activeId
          : accounts[0]?.id
        return { version: ACCOUNTS_RECORD_VERSION, activeId, accounts }
      }
    } catch {
      // Missing or corrupt accounts.json: try seeding from auth.json
    }

    // Seed from auth.json if present
    try {
      const authText = await readFile(authStorePath, 'utf8')
      const authRecord = JSON.parse(authText) as Record<string, unknown>
      if (
        typeof authRecord === 'object' &&
        authRecord !== null &&
        typeof authRecord.refreshToken === 'string' &&
        typeof authRecord.projectId === 'string'
      ) {
        const email = typeof authRecord.email === 'string' ? authRecord.email : undefined
        const initialAccount: CachedAccount = {
          id: 'acc_1',
          email,
          maskedEmail: maskEmail(email),
          projectId: authRecord.projectId,
          refreshToken: authRecord.refreshToken,
          updatedAt: typeof authRecord.updatedAt === 'string' ? authRecord.updatedAt : new Date().toISOString(),
          lineage: typeof authRecord.lineage === 'string' ? authRecord.lineage : undefined,
        }
        const seeded: AccountsData = {
          version: ACCOUNTS_RECORD_VERSION,
          activeId: initialAccount.id,
          accounts: [initialAccount],
        }
        await writeRaw(seeded)
        return seeded
      }
    } catch {
      // auth.json also absent
    }

    return {
      version: ACCOUNTS_RECORD_VERSION,
      activeId: undefined,
      accounts: [],
    }
  }

  async function writeRaw(data: AccountsData): Promise<void> {
    const dir = dirname(accountsPath)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const tempPath = `${accountsPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
    await writeFile(tempPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
    if (platform !== 'win32') {
      try {
        await chmod(tempPath, 0o600)
      } catch {
        // best effort
      }
    }
    await rename(tempPath, accountsPath)
  }

  return {
    path: accountsPath,
    read: readRaw,

    saveAccount: async (draft) => {
      const current = await readRaw()
      const accounts = [...current.accounts]
      const email = draft.email
      const masked = maskEmail(email)

      // Match existing account by email or by refreshToken
      let existingIndex = -1
      if (email !== undefined && email.trim().length > 0) {
        existingIndex = accounts.findIndex(a => a.email !== undefined && normalizeKey(a.email) === normalizeKey(email))
      }
      if (existingIndex < 0) {
        existingIndex = accounts.findIndex(a => a.refreshToken === draft.refreshToken)
      }

      let accountId: string
      let isNew = false

      if (existingIndex >= 0) {
        const existing = accounts[existingIndex]!
        accountId = existing.id
        accounts[existingIndex] = {
          ...existing,
          email: email ?? existing.email,
          maskedEmail: masked ?? existing.maskedEmail,
          projectId: draft.projectId,
          refreshToken: draft.refreshToken,
          updatedAt: draft.updatedAt ?? new Date().toISOString(),
          lineage: draft.lineage ?? existing.lineage,
        }
      } else {
        isNew = true
        accountId = draft.id ?? `acc_${accounts.length + 1}`
        accounts.push({
          id: accountId,
          email,
          maskedEmail: masked,
          projectId: draft.projectId,
          refreshToken: draft.refreshToken,
          updatedAt: draft.updatedAt ?? new Date().toISOString(),
          lineage: draft.lineage,
        })
      }

      const updated: AccountsData = {
        version: ACCOUNTS_RECORD_VERSION,
        activeId: accountId,
        accounts,
      }
      await writeRaw(updated)
      const savedAccount = accounts.find(a => a.id === accountId)!
      return { activeId: accountId, account: savedAccount, isNew }
    },

    setActive: async (idOrEmailOrIndex) => {
      const current = await readRaw()
      const match = findMatchingAccount(current.accounts, idOrEmailOrIndex)
      if (match === undefined) return undefined

      const updated: AccountsData = {
        ...current,
        activeId: match.account.id,
      }
      await writeRaw(updated)
      return match.account
    },

    removeAccount: async (idOrEmailOrIndex) => {
      const current = await readRaw()
      const match = findMatchingAccount(current.accounts, idOrEmailOrIndex)
      if (match === undefined) return undefined

      const remaining = current.accounts.filter(a => a.id !== match.account.id)
      let activeId = current.activeId
      if (activeId === match.account.id) {
        activeId = remaining[0]?.id
      }

      await writeRaw({
        version: ACCOUNTS_RECORD_VERSION,
        activeId,
        accounts: remaining,
      })
      return match.account
    },

    list: async () => {
      const current = await readRaw()
      return {
        activeId: current.activeId,
        accounts: current.accounts.map((acc, index) => ({
          ...acc,
          index: index + 1,
          isActive: acc.id === current.activeId,
        })),
      }
    },
  }
}
