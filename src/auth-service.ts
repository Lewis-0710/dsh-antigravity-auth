/** Host-side Antigravity risk gate, OAuth coordinator, and credential commit boundary. */

import type { AntigravityAuthRecord, AntigravityAuthStore } from './auth-store.ts'
import { createAuthStore, defaultAuthStorePath } from './auth-store.ts'
import { createOAuthFlow, OAuthFlowError } from './oauth-flow.ts'
import type {
  OAuthFlow,
  OAuthFlowCompletionResult,
  OAuthFlowOptions,
  OAuthToken,
  ProjectValidation,
} from './oauth-flow.ts'
import type {
  AntigravityStatusView,
  BootstrapStatusService,
  RiskAcknowledgementResult,
  LoginActionResult,
  LoginStartResult,
  LoginStatusView,
} from './status.ts'
import { createStatusView } from './status.ts'

export interface AntigravityAuthServiceOptions {
  readonly store?: AntigravityAuthStore
  readonly storePath?: string
  readonly flowOptions?: Omit<OAuthFlowOptions, 'commit'>
}

export interface HostCredential {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
  readonly projectId: string
}

export class AntigravityAuthService implements BootstrapStatusService {
  private readonly store: AntigravityAuthStore
  private readonly flow: OAuthFlow
  private riskAcknowledged = false
  private currentCredential: HostCredential | undefined
  private disposed = false

  constructor(options: AntigravityAuthServiceOptions = {}) {
    this.store = options.store ?? createAuthStore(options.storePath ?? defaultAuthStorePath())
    this.flow = createOAuthFlow({
      ...options.flowOptions,
      commit: (token, project, signal) => this.commitCredential(token, project, signal),
    })
  }

  async status(): Promise<AntigravityStatusView> {
    const record = await this.readRecord()
    const flowStatus = this.flow.status()
    const phase = flowStatus.phase === 'idle' && record !== undefined ? 'success' : flowStatus.phase
    const maskedEmail = maskEmail(record?.email)
    const login: LoginStatusView = {
      phase,
      configured: record !== undefined,
      projectAvailable: record?.projectId !== undefined,
      ...(flowStatus.authorizationUrl === undefined ? {} : { authorizationUrl: flowStatus.authorizationUrl }),
      ...(flowStatus.expiresAt === undefined ? {} : { expiresAt: flowStatus.expiresAt }),
      ...(maskedEmail === undefined ? {} : { maskedEmail }),
      ...(flowStatus.errorCode === undefined ? {} : { errorCode: flowStatus.errorCode }),
    }
    return createStatusView(this.riskAcknowledged, login)
  }

  async acknowledgeRisk(): Promise<RiskAcknowledgementResult> {
    this.riskAcknowledged = true
    return { acknowledged: true }
  }

  async startLogin(): Promise<LoginStartResult> {
    if (this.disposed) throw new OAuthFlowError('internal', 'The Antigravity login is unavailable')
    if (!this.riskAcknowledged) {
      throw new OAuthFlowError('risk-acknowledgement-required', 'Risk acknowledgement is required before login')
    }
    return this.flow.start()
  }

  async completeCallback(callbackUrl: string): Promise<OAuthFlowCompletionResult> {
    if (this.disposed) throw new OAuthFlowError('internal', 'The Antigravity login is unavailable')
    return this.flow.completeCallbackUrl(callbackUrl)
  }

  async cancelLogin(): Promise<LoginActionResult> {
    const status = await this.flow.cancel()
    return {
      phase: status.phase,
      ...(status.errorCode === undefined ? {} : { errorCode: status.errorCode }),
    }
  }

  async credential(): Promise<HostCredential | undefined> {
    return this.currentCredential === undefined ? undefined : { ...this.currentCredential }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.flow.dispose()
    this.currentCredential = undefined
  }

  private async commitCredential(token: OAuthToken, project: ProjectValidation, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new OAuthFlowError('cancelled', 'The OAuth login was cancelled')
    const current = await this.readRecord()
    if (signal.aborted) throw new OAuthFlowError('cancelled', 'The OAuth login was cancelled')
    const email = maskEmail(project.email ?? token.email)
    const draft = {
      refreshToken: token.refreshToken,
      projectId: project.projectId,
      ...(email === undefined ? {} : { email }),
    }
    const committed = await this.store.compareAndCommit(current?.revision ?? 0, draft)
    if (committed === undefined) throw new OAuthFlowError('credential-conflict', 'The login changed while it was completing')
    this.currentCredential = {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      projectId: project.projectId,
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
