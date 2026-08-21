# dsh-antigravity-auth

面向 DeepSeek Harness 的私有、单账号、非官方 Antigravity 实验插件。

## 当前阶段

本仓库提供一个 Host-only、可离线验证的**单账号 OAuth 登录路径**、**凭据生命周期
协调器**、只读 **project discovery**，以及插件自有的 **Wire Identity（线路身份）
seam**。token exchange 后，固定的 `v1internal:loadCodeAssist` probe 必须为当前账号
返回规范化 project，凭据才会提交。project 验证成功后，插件会启用自有的
`google-antigravity` LLM adapter、有 grounding 的网页搜索、受限图片生成/编辑、
配额查询，以及默认关闭的视频理解 POC。Host 与浏览器入口通过仅返回安全值的
loopback RPC 挂载，并展示独立的 Auth/LLM、搜索、图片和视频能力门禁。project
验证失败时所有私有能力都会安全禁用。不会执行 onboarding、project 创建，也没有
hard-coded 或用户提供的 fallback project。

登录路径明确分级：

1. 设置页先展示**非官方 / 实验性**警告和 Google 账号暂停风险。
2. 完成确认后，Host 内存生成 PKCE S256 材料，以及 256-bit、五分钟、一次性的 state
   句柄。浏览器只收到授权 URL，verifier 不跨越 Host 边界。
3. callback listener 只绑定 `127.0.0.1:51121`，只接受注册的 GET path/Host 和唯一的
   code/state pair；错误 method、path、Host、重复参数、拒绝、过期、取消和端口冲突都会
   返回安全且可区分的错误。
4. 远程用户可以通过 typed RPC 提交完整 callback URL；Host 仍然只绑定 loopback，也不会
   回显该 URL、code、state 或 token。
5. Host 通过统一的 Wire Identity 与 endpoint policy 执行固定的只读
   `loadCodeAssist` project probe。只接受 authenticated token 返回的规范化 project；空结果
   是 `project-unavailable`，authentication、forbidden、rate-limit、offline、malformed 与
   protocol-drift discovery failure 保持可区分的安全状态。
6. Project validation 必须成功，新凭据才会替换已有账号。版本化存储采用原子提交和
   owner-only 权限（`0700`/`0600`），只保存单账号允许的长期 refresh credential 与规范化元数据；
   access token 始终留在 Host 内存。

## 凭据生命周期

- Host 内存中的新鲜 access token 会在有界 refresh lead time 内复用；并发调用共享一次
  refresh 操作。
- refresh token 轮换只有在 revision 和每次登录的 lineage 都未变化时才提交；晚到的
  refresh 结果不能覆盖更新的登录或登出。
- `invalid_grant` 会显示为**需要重新登录**，同时保留诊断记录。网络、超时、限流和服务端
  失败都有界处理，不会选择备用账号、endpoint、quota pool 或 identity。
- **本地登出**只清除 Host 内存和本地持久化，不联系 Google。**撤销 Google grant** 是单独的
  确认操作；token 放在 form body 中发送，只有成功完成后才清除本地状态。
- RPC 与设置页会在不携带 token 的前提下展示已登录、刷新中、刷新失败、需要重新登录、已登出
  以及撤销结果状态。
- status refresh 与 retry 只读取已保存的规范化 project 状态，永远不会调用 onboarding 或创建
  project；只有新登录会执行只读 discovery probe。

默认 package 检查使用 fake endpoint、确定性的随机数/时钟适配器和内存 store。
`pnpm test`、`pnpm run check` 与 package smoke test 都不会发起 OAuth 或私有 endpoint 请求。
只有用户确认风险并打开授权 URL 后，真实登录才会开始。

## 能力包

- **LLM** 通过 DSH 公开的 `LlmAdapter` seam 提供固定模型快照、受限 SSE/JSON 翻译、
  一次仅限响应首个 delta 前的认证重放；不会进行普通重试。provider 签发的 thinking
  signature 只会以有界、按 block 对齐的 replay metadata 保存。
- **搜索** 使用 DSH `WebSearchProvider`，要求 provider 返回 grounding source。只有校验过的
  HTTP(S) URL、有界标题/摘要和回答文本会跨越结果边界。
- **图片** 提供 `generate_image` 与 `list_images`。引用只能是当前 session 明确授权的
  `image:<id>` handle，或经 DSH workspace filesystem admission 的文件。字节由
  `AttachmentStore` 校验和保存，原始 base64 不进入 session、RPC、日志或浏览器。
- **配额** 通过 value-safe `usage` RPC 展示五小时及每周窗口的剩余比例和 reset 时间；
  结果 30 秒内缓存/合并请求，原始 provider 字段、project ID 不会跨边界。
- **视频** 是默认关闭的 gated POC，只接受 active workspace 内受限的 MP4 文件并返回文本
  理解结果，不声称支持原生持久化视频 attachment。

搜索、图片和视频分别拥有命名空间化的 Host 设置；浏览器通过公开 `SettingsScope`
显示开关。只有登录、project 验证和可写设置 scope 都准备好时，开关才可用。

设置页仍明确标记为**非官方 / 实验性**。产品只支持单账号：没有账号数组、切换、轮换、
quota pool、identity fallback、fingerprint regeneration 或自动 onboarding。

## Wire Identity

Wire Identity 模块保留经过审计的 Antigravity provider headers，并调用 DSH 公开的
`attributionHeaders()` formatter，把真实 DSH 身份放入固定的二级 carrier：

```text
X-DeepSeek-Harness-Attribution: deepseek-harness/<version> (+repository-url)
```

调用方不能提供任意 headers，也不能省略、改名或替换二级 attribution。请求 endpoint
由代码固定：只接受固定的 HTTPS Antigravity origin 与列出的 `v1internal:` 操作路径；
自定义 origin、路径、query 和 fallback endpoint 都会被拒绝。header pairs 保留社区
HTTP/1.1 framing 的选择（`Content-Length` 或流式 chunked），不修改 DSH core。

## 安全与范围

- 这是私有、实验性、逆向得到的自用软件。
- Google 不支持第三方 Antigravity 登录工具，账号可能被暂停或终止。请阅读相关的
  [FAQ](https://antigravity.google/docs/faq/) 与 [Additional Terms](https://antigravity.google/terms/)。
- 默认构建和测试不会执行 profile 安装、npm 发布或真实请求。
- 不修改 DeepSeek Harness core、已安装的 package、用户 profile 或生成的 bundle。

## DSH 兼容性

最低且已经测试的开发基线是 **DSH `0.1.1-rc.1`**。DSH peer range 从
`^0.1.1-rc.1` 开始，开发依赖和 lockfile 固定使用 rc.1 package。干净安装不能混入
rc.7/rc.8 DSH peers；必须先通过 `pnpm peers check`，再运行 `pnpm run check`。

rc.1 新增的 credentials/authorization 和 session-projection interface 不改变本插件当前
设计：凭据继续由插件自有 Host modules 管理，provider 使用自定义 `LlmAdapter` 而不是
PiAiAdapter，公开 `attributionHeaders()` 仍是 Wire Identity formatter。升级证据见官方
[DSH `v0.1.1-rc.1` release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.1)
以及 workspace 中的 `dsh-v0.1.1-rc.1-plugin-impact.md` 影响报告。

## 开发

```sh
pnpm install
pnpm peers check
pnpm test
pnpm run check
```

默认测试是确定性的离线测试。完整的能力设计与研究边界见
[`docs/specs/antigravity-auth-capability-bundle.md`](docs/specs/antigravity-auth-capability-bundle.md)
和 [`docs/research/antigravity-auth-plugin.md`](docs/research/antigravity-auth-plugin.md)。
