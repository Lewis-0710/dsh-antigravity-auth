/** Host-side Antigravity risk gate, OAuth coordinator, and credential commit boundary. */

import type { AntigravityAuthRecord, AntigravityAuthStore } from './auth-store.ts'
import { createAuthStore, defaultAuthStorePath } from './auth-store.ts'
import { createCredentialCoordinator, type CredentialCoordinator, type CredentialCoordinatorOptions, type HostCredential } from './credential-coordinator.ts'
import { createOAuthFlow, OAuthFlowError } from './oauth-flow.ts'
import type {
  OAuthFlow,
  OAuthFlowCompletionResult,
  OAuthFlowOptions,
  OAuthToken,
  ProjectValidation,
} from './oauth-flow.ts'
import { createProjectDiscovery } from './project-context.ts'
import type { ProjectDiscoveryOptions } from './project-context.ts'
import type {
  AntigravityStatusView,
  BootstrapStatusService,
  RiskAcknowledgementResult,
  LoginActionResult,
  LoginStartResult,
  LoginStatusView,
} from './status.ts'
import { createStatusView } from './status.ts'
import { createQuotaService, type QuotaService, type QuotaServiceOptions } from './quota.ts'

export interface AntigravityAuthServiceOptions {
  readonly store?: AntigravityAuthStore
  readonly storePath?: string
  readonly flowOptions?: Omit<OAuthFlowOptions, 'commit' | 'validateProject'>
  /** Inject transport/identity dependencies only for deterministic Host tests. */
  readonly projectOptions?: ProjectDiscoveryOptions
  readonly credentialOptions?: Omit<CredentialCoordinatorOptions, 'store'>
  readonly quotaOptions?: Omit<QuotaServiceOptions, 'auth'>
}

export type { HostCredential } from './credential-coordinator.ts'

export class AntigravityAuthService implements BootstrapStatusService {
  private readonly store: AntigravityAuthStore
  private readonly credentials: CredentialCoordinator
  private readonly flow: OAuthFlow
  private readonly quota: QuotaService
  private riskAcknowledged = false
  private activeFlowGeneration = 0
  private disposed = false
  private readonly statusListeners = new Set<() => void>()

  constructor(options: AntigravityAuthServiceOptions = {}) {
    this.store = options.store ?? createAuthStore(options.storePath ?? defaultAuthStorePath())
    this.credentials = createCredentialCoordinator({
      ...options.credentialOptions,
      store: this.store,
    })
    this.quota = createQuotaService({
      ...options.quotaOptions,
      auth: this.credentials,
    })
    const projectDiscovery = createProjectDiscovery(options.projectOptions)
    this.flow = createOAuthFlow({
      ...options.flowOptions,
      validateProject: (accessToken, signal) => projectDiscovery.discover(accessToken, signal),
      commit: (token, project, signal) => this.commitCredential(token, project, signal),
    })
  }

  async status(): Promise<AntigravityStatusView> {
    const record = await this.readRecord()
    const flowStatus = this.flow.status()
    const phase = flowStatus.phase === 'idle' && record !== undefined ? 'success' : flowStatus.phase
    const maskedEmail = maskEmail(record?.email)
    const credentialStatus = await this.credentials.status()
    const login: LoginStatusView = {
      phase,
      configured: record !== undefined,
      projectAvailable: record?.projectId !== undefined,
      ...(flowStatus.authorizationUrl === undefined ? {} : { authorizationUrl: flowStatus.authorizationUrl }),
      ...(flowStatus.expiresAt === undefined ? {} : { expiresAt: flowStatus.expiresAt }),
      ...(maskedEmail === undefined ? {} : { maskedEmail }),
      ...(flowStatus.errorCode === undefined ? {} : { errorCode: flowStatus.errorCode }),
    }
    return createStatusView(this.riskAcknowledged, login, credentialStatus, this.credentials.revokeStatus())
  }

  async acknowledgeRisk(): Promise<RiskAcknowledgementResult> {
    this.riskAcknowledged = true
    this.notifyStatus()
    return { acknowledged: true }
  }

  /** Observe value-safe gate changes so capability rows can register without polling secrets. */
  watchStatus(listener: () => void): () => void {
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  async startLogin(): Promise<LoginStartResult> {
    if (this.disposed) throw new OAuthFlowError('internal', 'The Antigravity login is unavailable')
    if (!this.riskAcknowledged) {
      throw new OAuthFlowError('risk-acknowledgement-required', 'Risk acknowledgement is required before login')
    }
    const started = await this.flow.start()
    this.activeFlowGeneration = this.flow.generation()
    this.notifyStatus()
    return started
  }

  async completeCallback(callbackUrl: string): Promise<OAuthFlowCompletionResult> {
    if (this.disposed) throw new OAuthFlowError('internal', 'The Antigravity login is unavailable')
    try {
      return await this.flow.completeCallbackUrl(callbackUrl)
    } finally {
      this.notifyStatus()
    }
  }

  async cancelLogin(): Promise<LoginActionResult> {
    const status = await this.flow.cancel()
    if (status.phase !== 'success') this.activeFlowGeneration = 0
    this.notifyStatus()
    return {
      phase: status.phase,
      ...(status.errorCode === undefined ? {} : { errorCode: status.errorCode }),
    }
  }

  async credential(signal?: AbortSignal, options?: { readonly forceRefresh?: boolean }): Promise<HostCredential | undefined> {
    return await this.credentials.credential(signal, options)
  }

  async usage(signal?: AbortSignal, force = false): Promise<import('./quota.ts').QuotaStatusView> {
    return await this.quota.refresh(signal, force)
  }

  async logout(): Promise<import('./credential-coordinator.ts').LogoutResult> {
    if (this.disposed) throw new OAuthFlowError('internal', 'The Antigravity login is unavailable')
    this.activeFlowGeneration = 0
    await this.flow.cancel()
    try {
      const result = await this.credentials.logout()
      this.notifyStatus()
      return result
    } catch {
      throw new OAuthFlowError('persistence-failed', 'The local Antigravity credential could not be cleared')
    }
  }

  async revoke(confirmed: boolean, signal?: AbortSignal): Promise<import('./credential-coordinator.ts').RevokeActionResult> {
    if (this.disposed) throw new OAuthFlowError('internal', 'The Antigravity login is unavailable')
    const result = await this.credentials.revoke(confirmed, signal)
    this.notifyStatus()
    return result
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.activeFlowGeneration = 0
    this.statusListeners.clear()
    await Promise.all([this.flow.dispose(), this.credentials.dispose(), this.quota.dispose()])
  }

  private async commitCredential(token: OAuthToken, project: ProjectValidation, signal: AbortSignal): Promise<void> {
    const flowGeneration = this.flow.generation()
    if (this.disposed || flowGeneration !== this.activeFlowGeneration || signal.aborted) {
      throw new OAuthFlowError('cancelled', 'The OAuth login was cancelled')
    }
    const current = await this.readRecord()
    if (this.disposed || flowGeneration !== this.activeFlowGeneration || signal.aborted) {
      throw new OAuthFlowError('cancelled', 'The OAuth login was cancelled')
    }
    const email = maskEmail(project.email ?? token.email)
    const draft = {
      refreshToken: token.refreshToken,
      projectId: project.projectId,
      ...(email === undefined ? {} : { email }),
    }
    const committed = await this.store.compareAndCommit(current?.revision ?? 0, draft, current?.lineage)
    if (committed === undefined) throw new OAuthFlowError('credential-conflict', 'The login changed while it was completing')
    if (this.disposed || flowGeneration !== this.activeFlowGeneration || signal.aborted) {
      throw new OAuthFlowError('cancelled', 'The OAuth login was cancelled')
    }
    this.credentials.replaceFromLogin({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      projectId: project.projectId,
    }, committed)
  }

  private notifyStatus(): void {
    for (const listener of this.statusListeners) {
      try { listener() } catch { /* observer failures cannot change auth state */ }
    }
  }

  private async readRecord(): Promise<AntigravityAuthRecord | undefined> {
    try {
      return await this.store.read()
    } catch {
      throw new OAuthFlowError('persistence-failed', 'The Antigravity auth store could not be read')
    }
  }
}

export function createAntigravityAuthService(options: AntigravityAuthServiceOptions = {}): AntigravityAuthService {
  return new AntigravityAuthService(options)
}

export function maskEmail(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const at = value.indexOf('@')
  if (at <= 0 || at === value.length - 1 || value.length > 4096) return undefined
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (!/^[^\s@]+$/u.test(local) || !/^[^\s@]+$/u.test(domain)) return undefined
  return `${local.slice(0, 1)}***@${domain}`
}
