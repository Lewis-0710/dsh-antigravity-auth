# Changelog

## [Unreleased]

- Raised the minimum and tested DSH package baseline to `0.1.1-rc.1`, regenerated a coherent rc.1 lockfile, and added peer-graph verification before the full offline check.
- Confirmed that the rc.1 credentials/authorization, session-projection, client boot, and sandbox changes require no current Antigravity behavior migration; plugin-owned auth and Wire Identity modules remain unchanged.

## [0.1.0]

- Added the offline-verifiable Host-only single-account PKCE S256 login path with a strict loopback callback listener.
- Added one-shot state expiry/cancellation, fixed-port conflict handling, remote callback URL submission, and safe value-free login status RPC results.
- Added injected project validation and versioned owner-only atomic persistence; access tokens remain Host memory and failed validation preserves the existing account.
- Added pending, success, cancelled, expired, port-conflict, and safe failure settings states in English and Chinese.
- Added independently addressable, gate-visible Auth/LLM, Search, Image, and Video rows.
- Retained the plugin-owned Wire Identity seam and its fixed provider-attribution policy.
