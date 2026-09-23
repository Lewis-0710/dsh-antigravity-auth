/**
 * Antigravity logo in the settings navigation.
 *
 * DSH settings shell projects only `id` / `order` / `label` for third-party
 * sections and falls back to a generic gear icon. This client module identifies
 * the Antigravity section nav button and replaces the fallback glyph with the
 * official Antigravity "A" vector mark.
 */

export const NAV_ICON_MARKER = 'data-agy-nav-icon'
export const NAV_ROW_SELECTOR = '[role="dialog"] nav button'
export const NAV_ICON_SIZE = 16

/** Antigravity official mark as SVG data URL for CSS mask. */
export function antigravityMaskSvg(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000">'
    + '<path d="M12 3.2 2.6 21.9h3.2l2.03-4.1h8.34l2.03 4.1h3.2L12 3.2zm0 4.6 2.72 5.5H9.28L12 7.8z"/>'
    + '</svg>'
}

export function antigravityMaskUrl(svg: string = antigravityMaskSvg()): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function isOwnNavRow(rowText: string | null | undefined, wantedLabel: string | null | undefined): boolean {
  const wanted = String(wantedLabel ?? '').trim()
  if (wanted.length === 0) return false
  return String(rowText ?? '').trim() === wanted
}

export function navIconCss(maskUrl: string): string {
  return [
    `[${NAV_ICON_MARKER}] > svg { display: none !important; }`,
    `[${NAV_ICON_MARKER}]::before {`,
    `  content: '';`,
    `  flex: none;`,
    `  width: ${NAV_ICON_SIZE}px;`,
    `  height: ${NAV_ICON_SIZE}px;`,
    `  background-color: currentColor;`,
    `  -webkit-mask-image: url("${maskUrl}");`,
    `  mask-image: url("${maskUrl}");`,
    `  -webkit-mask-repeat: no-repeat;`,
    `  mask-repeat: no-repeat;`,
    `  -webkit-mask-position: center;`,
    `  mask-position: center;`,
    `  -webkit-mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `  mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `}`,
  ].join('\n')
}

export interface NavIconContext {
  effect(callback: () => unknown, label?: string): void
}

/**
 * Install the Antigravity nav icon in the settings dialog.
 */
export function installSettingsNavIcon(ctx: NavIconContext, resolveLabel: () => string): void {
  if (typeof document === 'undefined') return

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-antigravity-auth'
    tag.dataset.pluginCss = 'dsh-antigravity-auth/settings-nav-icon'
    tag.textContent = navIconCss(antigravityMaskUrl())
    document.head.appendChild(tag)

    let disposed = false
    let scheduled = false

    const sync = (): void => {
      scheduled = false
      if (disposed) return
      const wanted = resolveLabel()
      for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
        if (isOwnNavRow(row.textContent, wanted)) {
          row.setAttribute(NAV_ICON_MARKER, '')
        } else {
          row.removeAttribute(NAV_ICON_MARKER)
        }
      }
    }

    const schedule = (): void => {
      if (scheduled || disposed) return
      scheduled = true
      queueMicrotask(sync)
    }

    sync()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    return () => {
      disposed = true
      observer.disconnect()
      for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) {
        row.removeAttribute(NAV_ICON_MARKER)
      }
      tag.remove()
    }
  }, 'dsh-antigravity-auth: settings nav icon')
}
