# dsh-antigravity-auth

[![npm version](https://img.shields.io/npm/v/dsh-antigravity-auth.svg)](https://www.npmjs.com/package/dsh-antigravity-auth)
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

English | [中文](README.zh.md)

Current release: **v0.1.0**

A self-contained [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
**Antigravity Capability Bundle**. It integrates Antigravity's private OAuth session
and Wire Identity for:

- the `google-antigravity` LLM route (Gemini Flash, Gemini Pro, Claude Opus, Claude Sonnet, GPT-OSS);
- a Global Antigravity Search Provider behind DSH's stock `web_search` tool;
- durable image generation and editing through `generate_image`, plus the model-facing `list_images` catalog;
- multimodal workspace MP4 video understanding through `analyze_video`;
- resilient five-hour and weekly usage/quota visualization dashboard;
- one native **Antigravity Auth** Settings section with Login, Search, Image Creation, and Video cards.

> **⚠️ Unofficial channel — personal development only.** The private,
> account-gated Antigravity backend surface is unsupported, revocable, and
> may be rate-limited or changed without notice. Do not rely on it for
> production workloads.

## Features

### Shared Antigravity Login State

- Uses one Host-only auth coordinator for LLM, Search, Image, Video, and Quota operations.
- Direct OAuth 2.0 with PKCE S256: Host memory generates verifier and state handle; the browser receives only the authorization URL.
- The callback listener binds only `127.0.0.1:51121`, accepting only the registered one-shot code/state pair.
- Resolves credentials through versioned owner-only storage (`0600`), short-lived in-memory cache, and proactive refresh before expiry.
- Coalesces concurrent refreshes in-process and enforces account/lineage consistency before persisting refreshed tokens.
- Shows connection state plus real-time visual progress bars for 5-hour and weekly quotas across Gemini and Claude/GPT model families.
- Sends no token value over the loopback-only `/antigravity-auth` Connection RPC channel.

### LLM Routing & Models

- Registers the `google-antigravity` provider through DSH's public `LlmAdapter` seam.
- Intersects the pinned community model catalog with live account discovery.
- Supports streaming with pre-delta authentication replay and preserve-by-id function call correlation across fragmented provider names.

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

- DeepSeek Harness `0.1.1-rc.1` or a compatible later `0.1.x` release.
- Node.js `^22.19.0` or `>=24.0.0`.
- A Google account with Antigravity access.

## Install from npm (recommended)

The npm package includes prebuilt Host and browser bundles:

```sh
dsh plugin --profile web add dsh-antigravity-auth
```

Restart `dsh web`, open Settings, and select **Antigravity Auth**.

## Install from GitHub source

```sh
dsh plugin --profile web add github:suntianc/dsh-antigravity-auth
```

Git dependencies are built by the package's `prepare` script. If prompted by pnpm,
add the printed `allowBuilds` key to `~/.dsh/profiles/web/pnpm-workspace.yaml`,
then run the command again.

## Install a tarball

```sh
git clone https://github.com/suntianc/dsh-antigravity-auth.git
cd dsh-antigravity-auth
pnpm install
pnpm pack
dsh plugin --profile web add ./dsh-antigravity-auth-0.1.0.tgz
```

## Upgrade

Stop the running `dsh web` process and update the Web profile:

```sh
dsh plugin --profile web add dsh-antigravity-auth@0.1.0
dsh plugin --profile web list
```

Restart `dsh web` and refresh the browser.

## Host configuration

The bundle patch activates independent Host rows in dependency order:

| Row | Export | Purpose |
|---|---|---|
| `llm-antigravity-auth` | `dsh-antigravity-auth` | Shared auth coordinator and LLM route |
| `antigravity-search` | `dsh-antigravity-auth/search` | Global Search Provider |
| `antigravity-image` | `dsh-antigravity-auth/image` | Image generation & editing tools |
| `antigravity-video` | `dsh-antigravity-auth/video` | Video understanding tools |

## Wire Identity

The Wire Identity module keeps the audited Antigravity headers and adds the truthful DSH identity
returned by DSH's public `attributionHeaders()` formatter as the secondary carrier:

```text
X-DeepSeek-Harness-Attribution: deepseek-harness/<version> (+repository-url)
```

Requests are code-owned: only fixed HTTPS Antigravity origins and enumerated `v1internal:` operation paths are accepted.

## Security and limitations

- Token values never enter the browser, settings, logs, session events, or tool metadata. Only Host-side requests receive authorization headers.
- Single-account only: no account arrays, switching, rotation, quota pools, or identity fallback.
- Local logout clears local storage and in-memory caches immediately.
- The status/login RPC channel is restricted to loopback authorities.
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
