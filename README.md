# dsh-antigravity-auth

> **DSH compatibility:** Supports separately verified `0.1.2-alpha.5` and `0.1.3-alpha.1` graphs. The new DSH prerelease is source-only while its npm packages are unavailable; development dependencies retain alpha.5. See [source verification](docs/dsh-source-verification.md).

[![npm alpha version](https://img.shields.io/npm/v/dsh-antigravity-auth/alpha.svg?label=npm%20alpha)](https://www.npmjs.com/package/dsh-antigravity-auth)
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

English | [中文](README.zh.md)

Current alpha release: **v0.1.4-alpha.6**, supporting DSH `0.1.2-alpha.5` and `0.1.3-alpha.1`, with, Cordis `4.0.2`, and Schemastery `3.18.2`.

A self-contained [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
**Antigravity Capability Bundle**. It integrates Antigravity's private OAuth session
and Wire Identity for:

- the `google-antigravity` LLM route (Gemini 3.8/3.7/3.6 Flash, Gemini 3.1 Pro, Claude Opus, Claude Sonnet, GPT-OSS);
- a Global Antigravity Search Provider behind DSH's stock `web_search` tool;
- durable image generation and editing through `generate_image`, plus the model-facing `list_images` catalog;
- multimodal workspace MP4 video understanding through `analyze_video`;
- resilient five-hour and weekly usage/quota visualization dashboard;
- one native **Antigravity Auth** Settings section with Login, Search, Image Creation, and Video cards.

> **⚠️ Unofficial channel — personal development only.** The private,
> account-gated Antigravity backend surface is unsupported, revocable, and
> may be rate-limited or changed without notice. Do not rely on it for
> production workloads.

## v0.1.4-alpha.5 highlights

- Moves the development graph and peer baseline to DSH `0.1.2-alpha.5`, including current Settings, Session, Connection, client-injection, and `ToolCallId` APIs; this repository's lockfile contains no older DSH family.
- Adds authenticated Gemini 3.8 Flash discovery with a Medium default and captured Low/Medium/High routes, model enums, and numeric thinking budgets.
- Realigns every private Cloud Code `v1internal:` operation with the audited AGY CLI 1.1.24 wire identity while retaining mandatory truthful DSH secondary attribution.
- Drains successful provider terminal SSE framing and bodies, then uses the cancellation-safe async-iterable Web Stream bridge to prevent Node `ERR_INVALID_STATE` crashes.
- Keeps account RPC fail-closed on alpha.5: only an explicit `127.0.0.1` Web bind reaches authentication services.

## Features

### Shared Antigravity Login State

- Uses one Host-only auth coordinator for LLM, Search, Image, Video, and Quota operations.
- Direct OAuth 2.0 with PKCE S256: Host memory generates verifier and state handle; the browser receives only the authorization URL.
- The callback listener binds only `127.0.0.1:51121`, accepting only the registered one-shot code/state pair.
- Resolves credentials through versioned owner-only storage (POSIX `0600`; Windows user-data ACLs), short-lived in-memory cache, and proactive refresh before expiry.
- Coalesces concurrent refreshes in-process and enforces account/lineage consistency before persisting refreshed tokens.
- Shows connection state plus real-time visual progress bars for 5-hour and weekly quotas across Gemini and Claude/GPT model families.
- Sends no token value over `/antigravity-auth`. On DSH alpha.5, the real account dispatcher is mounted only for an explicit `127.0.0.1` Web bind; an absent, all-interface, or unknown bind receives an inert value-free denial handler.

### LLM Routing & Models

- Registers the `google-antigravity` provider through DSH's public `LlmAdapter` seam.
- Intersects the audited `@cortexkit/antigravity-auth-core@2.2.0` model snapshot with live account discovery, normalizing the provider's `gemini-3.8-flash-tiered` directory alias. Gemini 3.8 Flash uses the captured AGY 1.1.24 Low/Medium/High wire routes, numeric thinking budgets, model enums, `userAgent` envelope field, and Medium default.
- Keeps DSH's stock model selector usable when live discovery is temporarily unavailable or drifts by falling back to the pinned text snapshot; Settings still reports the live-catalog state. This advisory fallback can temporarily retain a legacy route such as Gemini 3.5 Flash, while a successful live intersection filters routes absent for the account. A successful empty intersection stays empty, while missing authentication, authorization denial, cancellation, and explicit attribution rejection remain fail-closed.
- Supports streaming with pre-delta authentication replay and preserve-by-id function call correlation across fragmented provider names. Successful terminal events drain the remaining SSE framing before DSH completion, while required cancellation paths use Node's async-iterable Web Stream bridge instead of the race-prone `Readable.toWeb()` adapter.

### Web Search

The `antigravity-search` Host row registers provider ID `antigravity` through
`@deepseek-ai/dsh-web`. Grounded web search requests are formatted and dispatched through
the audited Wire Identity dispatcher. Results include the generated output and deduplicated,
validated HTTP(S) source references.

### Image Creation & Editing

`generate_image` presents a unified operation dispatching to Antigravity image endpoints:

- Supports prompts, up to five explicit references (session handle `image:<id>` or workspace path), and size/aspect controls.
- Generated image bytes are validated, decoded, signature-checked, and persisted via `AttachmentStore`.
- `list_images` provides paginated session image catalogs for image-capable models.

### Video Understanding

Multimodal `analyze_video` tool accepts workspace MP4 videos, performing bounded frame sampling and textual comprehension.

### Usage & Quota Visual Dashboard

- Renders real-time progress bars for 5-Hour and Weekly limit windows.
- Clear status tiers: Normal (>60%, emerald green), Warning (30%–60%, amber), and Low (<30%, coral red).
- Elegant loading shimmer tracks and querying spinner animations.

## Requirements

- DeepSeek Harness `0.1.2-alpha.5` or `0.1.3-alpha.1` (separately verified graphs; direct peers accept both prerelease lines).
- Node.js `^22.19.0` or `>=24.0.0`.
- `pnpm` available on `PATH` (`11.7.0` is the tested project package manager).
- A Google account with Antigravity access.

## Install from npm

The npm package includes prebuilt Host and browser bundles. Install the release for either verified DSH graph explicitly:

```sh
dsh plugin --profile web add dsh-antigravity-auth@0.1.4-alpha.6
```

With the Web Host bound explicitly to `127.0.0.1`, restart `dsh web`, open Settings, and select **Antigravity Auth**.

## Install a prebuilt GitHub release

These GitHub examples pin the earlier 0.1.4-alpha.5 release; use the npm command above for 0.1.4-alpha.6.

```sh
dsh plugin --profile web add https://github.com/suntianc/dsh-antigravity-auth/releases/download/v0.1.4-alpha.5/dsh-antigravity-auth-0.1.4-alpha.5.tgz
```

## Install from the tagged GitHub source

These GitHub examples pin the earlier 0.1.4-alpha.5 release; use the npm command above for 0.1.4-alpha.6.

```sh
dsh plugin --profile web add github:suntianc/dsh-antigravity-auth#v0.1.4-alpha.5
```

Git dependencies are built by the package's `prepare` script. If prompted by pnpm,
add the printed `allowBuilds` key to the `pnpm-workspace.yaml` path printed by
dsh, then run the command again. Only grant this permission after reviewing the source.

## Install a tarball

```sh
npm pack dsh-antigravity-auth@0.1.4-alpha.6
dsh plugin --profile web add ./dsh-antigravity-auth-0.1.4-alpha.6.tgz
```

## Upgrade

Stop the running `dsh web` process and verify that the Host itself is already on DSH `0.1.2-alpha.5` or `0.1.3-alpha.1`; upgrade DSH first if it is not. Then install the matching plugin release and verify the profile entry:

```sh
dsh --version # must report 0.1.2-alpha.5 or 0.1.3-alpha.1
dsh plugin --profile web add dsh-antigravity-auth@0.1.4-alpha.6
dsh plugin --profile web list
```

Restart `dsh web` and refresh the browser.

## Terminal login command

On interactive surfaces that host the DSH `commands` seam, the bundle registers an `antigravity-auth` slash command as an alternative to the Web settings card:

```text
/antigravity-auth            # show current login state (default)
/antigravity-auth login      # start the Google OAuth authorization flow
/antigravity-auth cancel     # cancel a pending authorization
/antigravity-auth logout     # clear the shared Antigravity credential
```

Account operations are the terminal login entry point: they run on a local DSH Host (no WebServer at all, or one bound explicitly to `127.0.0.1`) and are denied before touching the auth service only when the WebServer exposes the shared `commands` seam on any other interface. The account RPC keeps its own stricter ADR-0008 guard (a real dispatcher on the explicit `127.0.0.1` bind only).

`login` acknowledges the unofficial-channel risk note and starts the loopback OAuth flow, whose temporary callback listener binds `127.0.0.1:51121` independently of any DSH WebServer. The command then opens the Google sign-in page in your default browser with a best-effort platform opener; the authorization URL is **not** echoed into the command result, because `CommandResult.text` is persisted verbatim into the session's `command/done` event and the URL carries the OAuth state handle and PKCE challenge. On Windows the opener is `cmd /c start "" "<url>"` with the URL quoted and Node's argument rewriting disabled, so every `&`-separated OAuth parameter reaches the browser intact. If the opener cannot start, the command reports that failure without reproducing the URL. Complete sign-in in the browser, then run `/antigravity-auth status`. Tokens, verifier, codes, and callback URLs never appear in command output or the session log. DSH exposes no public transient-presentation or browser-launch API for plugins, so on a Host without a desktop browser the interactive handoff cannot complete from the terminal.

## Host configuration

The bundle patch activates independent Host rows in dependency order:

| Row | Export | Purpose |
|---|---|---|
| `antigravity-auth` | `dsh-antigravity-auth` | Shared auth coordinator and LLM route |
| `antigravity-search` | `dsh-antigravity-auth/search` | Global Search Provider |
| `antigravity-image` | `dsh-antigravity-auth/image` | Image generation & editing tools |
| `antigravity-video` | `dsh-antigravity-auth/video` | Video understanding tools |

## Wire Identity

The Wire Identity module keeps the audited AGY CLI 1.1.24 content-request User-Agent and adds the truthful DSH identity returned by DSH's public `attributionHeaders()` formatter as the mandatory secondary carrier:

```text
X-DeepSeek-Harness-Attribution: deepseek-harness/<version> (+repository-url)
```

Requests are code-owned: only fixed HTTPS Antigravity origins and enumerated `v1internal:` operation paths are accepted.

## Security and limitations

- Token values never enter the browser, settings, logs, session events, or tool metadata. Only Host-side requests receive authorization headers.
- POSIX owner-only modes are enforced for auth, gate-evidence, and controlled live-image files. Windows access is governed by ACLs, so synthetic POSIX group/other bits are not treated as an access decision; symlink, file-type, size, schema, and content checks remain enforced.
- Single-account only: no account arrays, switching, rotation, quota pools, or identity fallback.
- Local logout clears local storage and in-memory caches immediately.
- DSH alpha.5 no longer exposes a per-method or Host-side carrier authority tier. The plugin therefore enables the real account RPC handler only when the public WebServer bind is exactly `127.0.0.1`; absent, all-interface, and unknown binds receive only `loopback-required`. The browser also hides the section when `ConnectionHandle.isLoopback` is false, but that client hint is UX only: an owner-contained custom carrier cannot be authorized until DSH exposes a corresponding Host-side fact.
- Raw media base64 never enters session text or browser RPC.

## Development

```sh
pnpm install
pnpm peers check
pnpm test
pnpm run check
```

`pnpm run build` emits:

- `lib/index.js` — Auth / LLM Host plugin;
- `lib/search.js` — Search Host plugin;
- `lib/image.js` — Image Host plugin;
- `lib/video.js` — Video Host plugin;
- `lib/quota.js` — Quota Host plugin;
- `lib/wire-identity.js` — Wire Identity Host module;
- `lib/client.cjs` — Loader-compatible browser settings plugin;
- `lib/types/**` — TypeScript declarations.

## Friendship links

- [LINUX DO (L 站)](https://linux.do/)
