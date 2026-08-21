# dsh-antigravity-auth

面向 DeepSeek Harness 的私有、单账号、非官方 Antigravity 实验插件。

## 当前阶段

本仓库当前只包含插件自有的 **Wire Identity（线路身份）** seam，尚不是完整的
Antigravity 登录或模型提供方，也不会自动挂载任何能力行。后续 OAuth、LLM、搜索、
图片、视频和用量能力必须分别通过离线测试门禁，并在得到单独明确授权后才能运行
真实 live gate。

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
- Google 不支持第三方 Antigravity 登录，账号可能被暂停或终止。请阅读相关的
  [FAQ](https://antigravity.google/docs/faq/) 与
  [Additional Terms](https://antigravity.google/terms/)。
- 默认构建和测试不会发起真实 OAuth、私有 endpoint 请求、profile 安装或 npm 发布。
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
