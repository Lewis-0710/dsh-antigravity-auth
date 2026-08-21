# Changelog

## [Unreleased]

- Removed callback-URL submission from browser RPC, added closed value-free RPC error validation, and made every settings action abort with component lifetime.
- Replaced private-endpoint `fetch` dispatch with a plugin-owned TLS/raw HTTP/1.1 serializer that fixes ordered audited `agy` framing and mandatory truthful DSH secondary attribution.
- Added credential-lineage-fenced, value-free Gate 0/L/S/I/V and independent atomically persisted Gemini/Claude/GPT-OSS outcomes; Auth/LLM is derived directly from all three rather than a separately writable aggregate pass.
- Added an explicitly acknowledged, one-gate-at-a-time packed `live:gates` harness that remains outside default checks, does not construct credential/network services before opt-in, and persists Gate I outputs through an owner-only content-addressed AttachmentStore seam after bounded PNG chunk/CRC/zlib/pixel admission.
- Exposed pinned snapshot, live-available, unavailable, refresh-failed, and protocol-drift model states while keeping exact pinned-model requests independent from advisory catalog absence; fixed call-id-correlated tool-result names and fragmented function-call assembly.
- Changed multi-image generation to independent no-retry requests with partial-success warnings, validates declared MIME against admitted bytes, and rechecks workspace target identity/version around bounded image/video reads.
- Made each Gate 0/L or selected family run one catalog-free request, distinguished generic forbidden failures from attribution rejection, made Gate V require an exact deterministic pixel-only fixture answer, and fenced replacement logins from prior-account gate evidence.
- Added the public Antigravity `LlmAdapter` with pinned/live-intersected model discovery, bounded SSE/JSON translation, pre-delta auth replay, and bounded provider replay metadata.
- Added grounded Web Search, AttachmentStore-backed image generation/edit/list tools, workspace media admission, quota/usage normalization, and the gated MP4 video understanding POC.
- Added Host settings namespaces, client SettingsScope toggles, quota-safe usage UI, and shared single-account service lifecycle wiring.
- Added offline transport, replay, quota, media, search, and adapter fixtures; package exports now include the bounded Host capability modules.
- Added fixed, read-only `loadCodeAssist` project discovery through the centralized Wire Identity policy; only normalized project metadata can gate and replace a single-account credential.
- Added distinct safe project discovery states for unavailable, authentication, forbidden, rate-limited, offline, malformed, and protocol-drift outcomes; no onboarding or fallback project is attempted.
- Raised the minimum and tested DSH package baseline to `0.1.1-rc.1`, regenerated a coherent rc.1 lockfile, and added peer-graph verification before the full offline check.
- Confirmed that the rc.1 credentials/authorization, session-projection, client boot, and sandbox changes require no current Antigravity behavior migration; plugin-owned auth and Wire Identity modules remain unchanged.

## [0.1.0]

- Added the offline-verifiable Host-only single-account PKCE S256 login path with a strict loopback callback listener.
- Added one-shot state expiry/cancellation, fixed-port conflict handling, remote callback URL submission, and safe value-free login status RPC results.
- Added injected project validation and versioned owner-only atomic persistence; access tokens remain Host memory and failed validation preserves the existing account.
- Added pending, success, cancelled, expired, port-conflict, and safe failure settings states in English and Chinese.
- Added independently addressable, gate-visible Auth/LLM, Search, Image, and Video rows.
- Retained the plugin-owned Wire Identity seam and its fixed provider-attribution policy.
