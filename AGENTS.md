# dsh-antigravity-auth Agent Guide

This file supplements the workspace-level `AGENTS.md`. The workspace guide remains authoritative for shared plugin, Git, verification, and delivery rules.

## Project identity

- Command target: `dsh-antigravity-auth`
- Local development root: `/Users/suntc/project/dsh-plugins/dsh-antigravity-auth`
- Canonical Git origin: `git@github.com:suntianc/dsh-antigravity-auth.git`
- GitHub repository: `https://github.com/suntianc/dsh-antigravity-auth`
- Issue tracker: `https://github.com/suntianc/dsh-antigravity-auth/issues`
- Parent implementation spec: GitHub issue `#1`
- Canonical local spec: `docs/specs/antigravity-auth-capability-bundle.md`
- Canonical research report: `docs/research/antigravity-auth-plugin.md`

The repository and issue tracker are private. Do not publish, change visibility, push, install into a live profile, or run live OAuth/private endpoint probes unless the user explicitly requests that separate action.

## Required session startup

For every implementation, review, spec, or ticket command targeting this project:

1. Set this project root as the working directory before running any command.
2. Verify `git rev-parse --show-toplevel` equals the local development root above; a parent repository is never acceptable.
3. Verify `git remote get-url origin` resolves to the canonical origin above. Do not infer, create, or rewrite a remote.
4. Fetch the requested issue from this repository, including comments and its parent issue/spec.
5. Read this guide, the parent spec, relevant research, current Git status, package metadata/README/patch when present, and relevant tests before editing.
6. Confirm every intended changed file is inside this repository. A path outside the project root is a hard scope error.
7. Preserve unrelated local files and user changes; this repository may initially contain uncommitted research/spec documents.

If any verification fails, stop and report the mismatch before changing files.

## Plugin-only implementation scope

- All implementation for this project belongs in this repository.
- Do not modify, fork, replace, commit to, or patch DeepSeek Harness core, the globally installed DSH checkout, another plugin, `node_modules`, generated DSH bundles, or a user profile.
- An issue in this tracker cannot authorize a DSH core change, even if its text mentions a missing core seam. Correct or split the issue instead of leaving the project.
- Register the Antigravity provider through existing public DSH plugin seams and a plugin-owned `LlmAdapter`; do not replace the `ctx.llm` runtime.
- The plugin-owned Wire Identity module keeps the fixed audited `agy` User-Agent/framing and obtains the truthful DSH identity value from public `attributionHeaders()`, carrying it in `X-DeepSeek-Harness-Attribution`.
- LLM, Search, Image, Video, Quota, and project discovery must share that one Host-only identity module; callers must not construct identity headers independently.
- OAuth credentials and secret-bearing network requests stay Host-side. Browser, RPC, settings, logs, fixtures, and session text never receive tokens, codes, verifiers, cookies, callback URLs, or media base64.
- The product is single-account only: no account arrays, switching, rotation, quota pools, identity fallback, fingerprint regeneration, automatic onboarding, or fallback project.
- Default development and `pnpm run check` are offline. Live OAuth and private endpoint calls always require a new explicit user authorization.

## Slash-command examples

Use the workspace command target explicitly in new sessions:

```text
/implement dsh-antigravity-auth #issue2
/code-review dsh-antigravity-auth main #issue2
/to-spec dsh-antigravity-auth
/to-tickets dsh-antigravity-auth #issue1
/research dsh-antigravity-auth <topic>
```

- `#issue2` and `#2` both mean issue 2 in this repository only.
- `/implement dsh-antigravity-auth #issue2` means implementation may change only this project root; it never means “follow issue text into deepseek-harness.”
- `/code-review` additionally requires an explicit fixed point such as `main` or a commit SHA and a non-empty three-dot diff.
- A full issue URL is accepted only when it belongs to `suntianc/dsh-antigravity-auth`.

## Current source-of-truth correction

Issue `#2` is plugin-only and owns the plugin Wire Identity module. Any prior experiment that implemented issue `#2` in DeepSeek Harness core is out of scope and must be reverted or excluded. The updated issue body, parent issue `#1`, local spec, and this guide supersede the earlier core-scope interpretation.

## Delivery report

Every handoff must state:

- local development root and canonical origin;
- issue number and parent spec;
- branch and fixed point when reviewing;
- changed files;
- tests/checks executed;
- whether any live account, profile, remote, commit, push, publish, or deployment action occurred.
