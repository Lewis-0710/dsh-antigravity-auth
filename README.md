# dsh-antigravity-auth

Private, single-account, unofficial Antigravity integration experiments for DeepSeek Harness.

## Current phase

This repository currently contains only the plugin-owned **Wire Identity** seam.
It is not a complete Antigravity login or model provider and does not auto-mount
any capability row. Later OAuth, LLM, Search, Image, Video, and Usage work must
pass separate offline and explicitly authorized live gates.

The Wire Identity module keeps the fixed audited Antigravity provider headers and
adds the truthful DSH identity returned by DSH's public `attributionHeaders()`
formatter as the fixed secondary carrier:

```text
X-DeepSeek-Harness-Attribution: deepseek-harness/<version> (+repository-url)
```

Callers cannot supply arbitrary headers or suppress, rename, or replace the
secondary attribution. Requests are code-owned: only the fixed HTTPS Antigravity
origin and the enumerated `v1internal:` operation paths are accepted; custom
origins, paths, queries, and fallback endpoints are rejected. Header pairs
preserve the community HTTP/1.1 framing choice (content length versus chunked
streaming) without modifying DSH core.

## Safety and scope

- This is private, experimental, reverse-engineered self-use software.
- Google does not support third-party Antigravity login and may suspend or
  terminate accounts. Review the applicable [FAQ](https://antigravity.google/docs/faq/)
  and [Additional Terms](https://antigravity.google/terms/).
- No real OAuth, private endpoint, profile installation, or npm publication is
  performed by the default build or tests.
- DeepSeek Harness core, installed packages, user profiles, and generated
  bundles are not modified.

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
