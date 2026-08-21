# dsh-antigravity-auth

Private, single-account, unofficial Antigravity integration experiments for DeepSeek Harness.

## Current phase

This repository ships a Host-only, offline-verifiable **single-account OAuth login
path** and **credential lifecycle coordinator** plus the plugin-owned **Wire Identity**
seam. The Host and browser entries mount through a value-safe loopback RPC and
render independently addressable Auth/LLM, Search, Image, and Video gate rows. LLM,
Search, Image, and Video remain `POC pending`; this is not a complete model provider.

The login path is deliberately gated:

1. The settings section shows the **Unofficial / Experimental** warning and Google
   account-suspension risk.
2. After acknowledgement, Host memory creates PKCE S256 material and a 256-bit,
   five-minute, one-shot state handle. The browser receives only the authorization
   URL; the verifier never crosses the Host boundary.
3. The callback listener binds only `127.0.0.1:51121`, accepts only the registered
   GET path/Host and one code/state pair, and reports safe errors for malformed,
   duplicate, denied, expired, cancelled, or conflicting flows.
4. Remote users may submit a complete callback URL through the typed RPC; the Host
   still binds only loopback and never echoes that URL, code, state, or token.
5. A Host-injected project validator must succeed before the new credential replaces
   the existing account. The versioned store is atomic and owner-only (`0700`/
   `0600`); it contains only the single account's long-lived refresh credential and
   allowed metadata. Access tokens remain Host memory.

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

The default package checks use fake endpoints, deterministic adapters, and an
in-memory store. No OAuth or private endpoint request is made by `pnpm test`,
`pnpm run check`, or the package smoke test. A real login starts only after a user
acknowledges the warning and opens the authorization URL.

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
origins, paths, queries, and fallback endpoints are rejected. Header pairs preserve
the community HTTP/1.1 framing choice (content length versus chunked streaming)
without modifying DSH core.

## Safety and scope

- This is private, experimental, reverse-engineered self-use software.
- Google does not support third-party Antigravity login and may suspend or
  terminate accounts. Review the applicable [FAQ](https://antigravity.google/docs/faq/)
  and [Additional Terms](https://antigravity.google/terms/).
- No profile installation, npm publication, or live request is performed by the
  default build or tests.
- DeepSeek Harness core, installed packages, user profiles, and generated bundles
  are not modified.

## Development

```sh
pnpm install
pnpm test
pnpm run check
```

The default tests are deterministic and offline. See
[`docs/specs/antigravity-auth-capability-bundle.md`](docs/specs/antigravity-auth-capability-bundle.md)
and [`docs/research/antigravity-auth-plugin.md`](docs/research/antigravity-auth-plugin.md)
for the parent capability design and research boundaries.
