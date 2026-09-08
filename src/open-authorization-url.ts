/**
 * Best-effort Host browser launch that hands the terminal user the OAuth
 * authorization URL without persisting it in the session's `command/done`
 * event (that event follows ordinary session persistence).
 *
 * DSH exposes no public transient-presentation or browser-authority API for
 * plugins to hand off an external login URL, so this module spawns the
 * platform default opener directly, mirroring the best-effort helper the DSH
 * TUI renderer uses for its own hrefs, and swallows every failure: a Host
 * without a desktop browser simply cannot complete interactive Google sign-in
 * from the terminal (documented limitation; no public Host API exists to
 * close it).
 *
 * @module antigravity-auth/open-authorization-url
 */

import { spawn, type ChildProcess } from 'node:child_process'

/** Spawn used to launch the platform opener. */
export type OpenSpawnFn = typeof spawn

/** One platform default-browser opener invocation. */
export interface OpenerSpec {
  /** Executable. */
  readonly command: string
  /** Arguments, with the URL last on POSIX. */
  readonly args: string[]
}

/** The Google authorization endpoint this plugin starts logins against. */
const AUTHORIZATION_HOST = 'accounts.google.com'

/**
 * Resolve the host default-browser opener. Darwin uses `open`, Windows
 * `cmd /c start`, elsewhere `xdg-open`.
 * @param platform - `process.platform` snapshot.
 * @param url - already-validated https authorization URL.
 */
export function openerSpec(platform: NodeJS.Platform, url: string): OpenerSpec {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] }
  return { command: 'xdg-open', args: [url] }
}

/**
 * Whether a candidate is the Google authorization endpoint this plugin starts.
 * @param value - candidate authorization URL.
 */
export function isAntigravityAuthorizationUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.hostname === AUTHORIZATION_HOST
      && parsed.pathname.startsWith('/o/oauth2/')
  } catch {
    return false
  }
}

/**
 * Open the authorization URL in the host default browser, best effort.
 * @param url - the Google authorization URL returned by `OAuthFlow.start()`.
 * @param spawnFn - injectable spawn.
 * @param platform - injectable platform.
 */
export function openAuthorizationUrl(
  url: string,
  spawnFn: OpenSpawnFn = spawn,
  platform: NodeJS.Platform = process.platform,
): void {
  if (!isAntigravityAuthorizationUrl(url)) return
  const spec = openerSpec(platform, url)
  try {
    const child: ChildProcess = spawnFn(spec.command, spec.args, {
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', () => {
      // Missing opener or EACCES: the launch is best-effort.
    })
    child.unref()
  } catch {
    // spawn threw synchronously (invalid argv on a stub): ignore.
  }
}
