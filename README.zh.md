# dsh-antigravity-auth

面向 DeepSeek Harness 的私有、单账号、非官方 Antigravity 实验插件。

## 当前阶段

本仓库提供一个 Host-only、可离线验证的**单账号 OAuth 登录路径**，以及插件自有的
**Wire Identity（线路身份） seam**。Host 与浏览器入口通过仅返回安全值的 loopback RPC
挂载，并展示独立的 Auth/LLM、搜索、图片和视频能力门禁。LLM、搜索、图片和视频仍是
`POC 待验证`，本版本不是完整的模型提供方。

登录路径明确分级：

1. 设置页先展示**非官方 / 实验性**警告和 Google 账号暂停风险。
2. 完成确认后，Host 内存生成 PKCE S256 材料，以及 256-bit、五分钟、一次性的 state
   句柄。浏览器只收到授权 URL，verifier 不跨越 Host 边界。
3. callback listener 只绑定 `127.0.0.1:51121`，只接受注册的 GET path/Host 和唯一的
   code/state pair；错误 method、path、Host、重复参数、拒绝、过期、取消和端口冲突都会
   返回安全且可区分的错误。
4. 远程用户可以通过 typed RPC 提交完整 callback URL；Host 仍然只绑定 loopback，也不会
   回显该 URL、code、state 或 token。
5. Host 注入的 project validator 必须成功，新凭据才会替换已有账号。版本化存储采用
   原子提交和 owner-only 权限（`0700`/`0600`），只保存单账号允许的长期 refresh credential
   与元数据；access token 始终留在 Host 内存。

默认 package 检查使用 fake endpoint、确定性的随机数/时钟适配器和内存 store。
`pnpm test`、`pnpm run check` 与 package smoke test 都不会发起 OAuth 或私有 endpoint 请求。
只有用户确认风险并打开授权 URL 后，真实登录才会开始。

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

## 开发

```sh
pnpm install
pnpm test
pnpm run check
```

默认测试是确定性的离线测试。完整的能力设计与研究边界见
[`docs/specs/antigravity-auth-capability-bundle.md`](docs/specs/antigravity-auth-capability-bundle.md)
和 [`docs/research/antigravity-auth-plugin.md`](docs/research/antigravity-auth-plugin.md)。
