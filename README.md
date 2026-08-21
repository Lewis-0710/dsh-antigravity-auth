# dsh-antigravity-auth

Private, single-account, unofficial Antigravity integration experiments for DeepSeek Harness.

## Current phase

This repository ships a Host-only, offline-verifiable **single-account OAuth login
path**, **credential lifecycle coordinator**, read-only **project discovery**, and the
plugin-owned **Wire Identity** seam. After token exchange, the fixed
`v1internal:loadCodeAssist` probe must return a normalized project for that account
before the credential is committed. Project discovery alone does **not** enable private
capabilities: the plugin-owned `google-antigravity` LLM adapter, grounded Web Search
provider, bounded image tools, and video POC register only after their explicit live
gate evidence passes. The Host and browser entries mount through value-safe loopback
RPC and render independently addressable Auth/LLM, Search, Image, and Video rows. A
failed project or Gate 0 disables every private capability. No onboarding, project
creation, hard-coded fallback, or user-supplied fallback is used.

The login path is deliberately gated:

1. The settings section shows the **Unofficial / Experimental** warning and Google
   account-suspension risk.
2. After acknowledgement, Host memory creates PKCE S256 material and a 256-bit,
   five-minute, one-shot state handle. The browser receives only the authorization
   URL; the verifier never crosses the Host boundary.
3. The callback listener binds only `127.0.0.1:51121`, accepts only the registered
   GET path/Host and one code/state pair, and reports safe errors for malformed,
   duplicate, denied, expired, cancelled, or conflicting flows.
4. Callback completion is Host-only. The browser RPC has no callback-URL method and
   never receives or submits a code, state, verifier, token, cookie, or callback URL.
5. The Host performs the fixed, read-only `loadCodeAssist` project probe through the
   centralized Wire Identity and endpoint policy. It accepts only a normalized project
   returned for the authenticated token; an empty result is `project-unavailable`, and
   authentication, forbidden, rate-limit, offline, malformed, and protocol-drift
   failures remain distinct safe states.
6. Project validation must succeed before the new credential replaces the existing
   account. The versioned store is atomic and owner-only (`0700`/`0600`); it contains
   only the single account's long-lived refresh credential and allowed normalized
   metadata. Access tokens remain Host memory.

## Credential lifecycle

- A fresh Host access token is reused until its bounded refresh lead time; concurrent
  callers share one refresh operation.
- Refresh-token rotation is committed only when the observed revision and per-login
  lineage still match. A late refresh cannot overwrite a newer login or logout.
- `invalid_grant` is surfaced as **re-login required** while the diagnostic record is
  retained. Network, timeout, rate-limit, and server failures are bounded and never
  select a fallback account, endpoint, quota pool, or identity.
- **Log out locally** clears Host memory and local persistence without contacting Google.
  **Revoke Google grant** is a separate confirmed action; the token is sent in a form
  body and local state is cleared only after successful completion.
- RPC and settings status expose logged-in, refreshing, refresh-failed, re-login-required,
  logged-out, and revoke-result states without token material.
- Status refresh and retry read the stored normalized project state; they never invoke
  onboarding or project creation. A new login is the only path that performs the
  read-only discovery probe.

The default package checks use whole-transport deterministic test doubles and an
in-memory store. Those transport seams are Host-only constructor inputs for offline
fixtures; production Cordis wiring never exposes them through config, RPC, or settings. No OAuth or private endpoint request is made by `pnpm test`,
`pnpm run check`, or the package smoke test. A real login starts only after a user
acknowledges the warning and opens the authorization URL.

## Capability bundle

- **LLM** uses the public DSH `LlmAdapter` seam and presents the pinned community
  snapshot separately from the authenticated account's bounded live intersection.
  Settings show snapshot, live-available, unavailable, refresh-failed, and protocol-drift
  states; successful discovery is cached for 30 seconds and can be refreshed manually
  only after Gate 0/L. Catalog absence remains advisory and never rejects an exact pinned
  model request. Streaming has one pre-delta authentication replay and no normal retries;
  tool results retain their original
  call-id-correlated function names, including fragmented provider names.
- **Search** registers DSH's `WebSearchProvider` seam and requires provider grounding
  sources. Only validated HTTP(S) source URLs, bounded titles/snippets, and answer
  text cross the result boundary.
- **Image** exposes `generate_image` and `list_images`. `n > 1` dispatches explicit
  independent requests without retrying failed metered requests; partial successes
  carry only fixed warning codes. Provider MIME declarations must match admitted magic
  bytes. References may be an authorized session handle (`image:<id>`) or a workspace
  file admitted through DSH filesystem containment, final-target no-symlink,
  regular-file, and before/after identity/version checks. Bytes are saved by `AttachmentStore`; raw media base64
  never enters session text, RPC, logs, or the browser.
- **Quota** exposes normalized five-hour and weekly remaining fractions and reset
  timestamps through a value-safe `usage` RPC. Results are cached/coalesced for 30
  seconds, have bounded transport lifetimes, and never expose project IDs or raw
  provider quota fields.
- **Video** is a gated proof of concept, disabled by default. It accepts only a
  bounded MP4 selected inside the active workspace and returns text understanding;
  it does not claim native durable video attachment support.

Search, Image, and Video each own a namespaced Host settings section and the browser
settings card uses the public `SettingsScope` seam. Toggles are disabled until login,
project validation, the matching live gate, and a writable settings scope are all ready.

The settings section remains explicitly **Unofficial / Experimental**. This is
single-account only: there are no account arrays, switching, rotation, quota pools,
identity fallback, fingerprint regeneration, or automatic onboarding.

## Wire Identity

The Wire Identity module keeps the fixed audited Antigravity provider headers and
adds the truthful DSH identity returned by DSH's public `attributionHeaders()`
formatter as the fixed secondary carrier:

```text
X-DeepSeek-Harness-Attribution: deepseek-harness/<version> (+repository-url)
```

Callers cannot supply arbitrary headers or suppress, rename, or replace the
secondary attribution. Requests are code-owned: only the fixed HTTPS Antigravity
origin and the enumerated `v1internal:` operation paths are accepted; custom
origins, paths, queries, and fallback endpoints are rejected. A plugin-owned TLS/raw
HTTP/1.1 dispatcher serializes the exact audited ordered header pairs and chunk framing;
it does not rely on `fetch` to preserve wire order. The secondary attribution is never
silently removed, and no DSH core change is required.

## Explicit live gates

Live gates are excluded from `pnpm test` and `pnpm run check`. The CLI accepts exactly
one of `A`, `0L`, `S`, `I`, or `V` per invocation and constructs the credential/network
runner only after both acknowledgements are present:

```sh
DSH_ANTIGRAVITY_LIVE_ACK=I_ACKNOWLEDGE_UNOFFICIAL_ANTIGRAVITY_PRIVATE_ENDPOINT_RISK \
  pnpm run live:gates -- --acknowledge-private-risk --gate 0L
# After Gate 0 passes, run each family separately, for example:
DSH_ANTIGRAVITY_LIVE_ACK=I_ACKNOWLEDGE_UNOFFICIAL_ANTIGRAVITY_PRIVATE_ENDPOINT_RISK \
  pnpm run live:gates -- --acknowledge-private-risk --gate 0L --family claude
```

Gate `A` performs interactive OAuth/project validation. Plain `0L` verifies fixed
attribution with one minimal text request; three later one-request invocations select
`--family gemini`, `--family claude`, and `--family gpt-oss`. Each family has one
atomically persisted independent outcome, and Auth/LLM is derived directly from those
three outcomes—never a separate aggregate pass—so it becomes available only after all pass. `S`
verifies grounded sources; `I` performs one minimal generation and edit through an
owner-only, content-addressed durable AttachmentStore seam beside the auth store; its
PNG admission verifies chunk CRCs, required data/end chunks, bounded zlib decode, row
filters, and pixel dimensions before persistence. `V` additionally requires
`--video-file <workspace-fixture.mp4>`. That controlled short fixture must visibly
show the unrelated uppercase word `KUMQUAT` in its center, while its filename and container
metadata must not contain that word. Gate V asks a fixed pixel-only question and passes only
when the exact expected word is returned. Gate evidence is fenced by credential lineage;
a crash or failed physical cleanup cannot authorize a replacement account with prior
evidence. The evidence record contains only closed, value-free gate/family outcomes;
Gate I's separate content store retains only admitted image bytes under opaque digest IDs.
A passed project probe is never substituted for an
unrun gate, and a failed or pending Video gate leaves the video tool absent.

## Safety and scope

- This is private, experimental, reverse-engineered self-use software.
- Google does not support third-party Antigravity login and may suspend or
  terminate accounts. Review the applicable [FAQ](https://antigravity.google/docs/faq/)
  and [Additional Terms](https://antigravity.google/terms/).
- Standard HTTPS proxy environment variables are honored through CONNECT. Optional proxy
  credentials are bounded and confined to the proxy handshake; private bearer credentials
  remain inside the tunneled TLS request, and unsafe credential framing is rejected.
- DSH rc.1 `FileSystem` has no guarded file-descriptor read seam. Workspace media
  admission therefore rechecks containment and identity/version around each bounded
  read; it detects observed replacement but does not claim atomic TOCTOU proof.
- No profile installation, npm publication, or live request is performed by the
  default build or tests.
- DeepSeek Harness core, installed packages, user profiles, and generated bundles
  are not modified.

## DSH compatibility

The minimum and tested development baseline is **DSH `0.1.1-rc.1`**. DSH peer
ranges start at `^0.1.1-rc.1`, while the development graph and lockfile use the
exact rc.1 packages. A clean install must have no mixed rc.7/rc.8 DSH peers and
must pass `pnpm peers check` before `pnpm run check`.

The rc.1 credentials/authorization and session-projection additions do not change
this plugin's current design: credentials remain behind the plugin-owned Host
modules, the provider uses a custom `LlmAdapter` rather than PiAiAdapter, and the
public `attributionHeaders()` interface remains the Wire Identity formatter. See
the official [DSH `v0.1.1-rc.1` release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.1)
and the workspace impact report named `dsh-v0.1.1-rc.1-plugin-impact.md` for the
upgrade evidence.

## Development

```sh
pnpm install
pnpm peers check
pnpm test
pnpm run check
```

The default tests are deterministic and offline. See
[`docs/specs/antigravity-auth-capability-bundle.md`](docs/specs/antigravity-auth-capability-bundle.md)
and [`docs/research/antigravity-auth-plugin.md`](docs/research/antigravity-auth-plugin.md)
for the parent capability design and research boundaries.
