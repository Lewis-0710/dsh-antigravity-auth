# dsh-antigravity-auth

[![npm version](https://img.shields.io/npm/v/dsh-antigravity-auth.svg)](https://www.npmjs.com/package/dsh-antigravity-auth)
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[English](README.md) | 中文

当前版本：**v0.1.2**

这是一个自包含的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
**Antigravity 能力包**。它集成了 Antigravity 的私有 OAuth 登录态与 Wire Identity 线路身份，提供：

- `google-antigravity` LLM 路由（Gemini Flash、Gemini Pro、Claude Opus、Claude Sonnet、GPT-OSS）；
- 接入 DSH 内置 `web_search` 工具的全局 Antigravity 搜索提供方；
- 通过 `generate_image` 实现持久图片生成与编辑，并提供供模型使用的 `list_images` 目录；
- 支持本地工作区 MP4 文件的多模态 `analyze_video` 视频理解；
- 具备优雅动效的 5 小时与每周用量/配额可视化仪表盘；
- 一个原生 **Antigravity Auth** 设置分区，内含「登录」「网页搜索」「图片创作」「视频理解」四张卡片。

> **⚠️ 非官方通道——仅限个人开发。** 私有、受账户权限控制的 Antigravity
> 后端服务未获官方支持、可随时撤销，也可能在没有通知的情况下被限流或变更。请勿依赖它承载生产任务。

## 功能特性

### 共享 Antigravity 登录态

- LLM、搜索、图片、视频与配额操作共用一个仅运行于 Host 的认证协调器。
- 直连 OAuth 2.0 PKCE S256 流程：Host 内存生成 verifier 与 state 句柄，浏览器仅接收授权链接，密钥绝不跨越 Host 边界。
- 回调监听器仅绑定 `127.0.0.1:51121`，只接受一次性的已注册 code/state 凭据对。
- 通过属主权限文件存储（POSIX `0600`；Windows 用户数据目录 ACL）、短时内存缓存解析凭证，并在到期前主动刷新。
- 进程内合并并发刷新请求；仅在账号与 lineage 未变化时原子提交新 token。
- 仪表盘实时显示连接状态以及 Gemini 与 Claude/GPT 模型家族的 5 小时和每周额度进度条。
- 插件自有、仅允许 loopback 的 `/antigravity-auth` Connection RPC 绝不向前端泄露任何 token 敏感值。

### LLM 路由与模型发现

- 通过 DSH 公开的 `LlmAdapter` 接口注册 `google-antigravity` 提供方。
- 将已审计的固定社区模型快照与真实登录账号的可用模型取交集。
- 当真实模型发现暂时不可用或发生协议漂移时，DSH 内置模型选择器会回退到固定文本模型快照，设置页仍诚实显示 live catalog 状态；成功但零交集的结果仍保持为空，未登录、授权拒绝、取消与明确的 attribution 拒绝仍保持 fail-closed。
- 流式传输支持首个数据块前的一次认证重放，并支持跨分片提供方函数名的 call-id 稳定关联。

### 网页搜索

`antigravity-search` Host 行通过 `@deepseek-ai/dsh-web` 注册 ID 为 `antigravity` 的全局搜索提供方。基于审计过的 Wire Identity 线路分发请求，返回真实 grounding 来源与去重检验过的 HTTP(S) 链接。

### 图片创作与编辑

`generate_image` 为模型提供统一操作接口，分发至 Antigravity 图片端点：

- 支持提示词、最多 5 个显式参考图（会话句柄 `image:<id>` 或工作区路径）及尺寸/比例选项。
- 返回的图片字节经过格式校验、解码、Magic bytes 签名验证并通过 `AttachmentStore` 持久保存。
- `list_images` 提供会话持久图片分页目录，供多模态模型查看。

### 视频理解

多模态 `analyze_video` 工具支持本地工作区 MP4 视频的帧采样与内容文本理解。

### 用量与配额可视化仪表盘

- 直观展示 5 小时窗口与每周窗口的剩余配额比例与刷新倒计时。
- 状态三档配色：充足（>60%，翡翠绿）、预警（30%–60%，警示橙）、紧急（<30%，警示红）。
- 配备 Shimmer 微光流动轨道、微型 Spinner 与平滑展开动画。

## 环境要求

- DeepSeek Harness `0.1.1-rc.2` 或兼容的后续 `0.1.x` 版本。
- Node.js `^22.19.0` 或 `>=24.0.0`。
- 具有 Antigravity 权限的 Google 账号。

## 从 npm 安装（推荐）

npm 包包含预构建的 Host 与浏览器 bundle，无需安装期构建权限：

```sh
dsh plugin --profile web add dsh-antigravity-auth
```

重启 `dsh web`，打开设置并选择 **Antigravity Auth**。

## 从 GitHub 源码安装

```sh
dsh plugin --profile web add github:suntianc/dsh-antigravity-auth
```

Git 依赖会通过包内 `prepare` 脚本从源码构建。如遇 pnpm 提示，将输出的 `allowBuilds` 键添加到 `~/.dsh/profiles/web/pnpm-workspace.yaml`，再重新执行安装。

## 从 tarball 安装

```sh
git clone https://github.com/suntianc/dsh-antigravity-auth.git
cd dsh-antigravity-auth
pnpm install
pnpm pack
dsh plugin --profile web add ./dsh-antigravity-auth-0.1.2.tgz
```

## 升级

先停止正在运行的 `dsh web`，再将 Web Profile 更新到当前版本：

```sh
dsh plugin --profile web add dsh-antigravity-auth@0.1.2
dsh plugin --profile web list
```

重启 `dsh web` 并刷新浏览器。

## Host 配置

能力包 patch 按依赖顺序启用独立的 Host 行：

| 行 | Export | 作用 |
|---|---|---|
| `llm-antigravity-auth` | `dsh-antigravity-auth` | 共享认证协调器与 LLM 路由 |
| `antigravity-search` | `dsh-antigravity-auth/search` | 全局搜索提供方 |
| `antigravity-image` | `dsh-antigravity-auth/image` | 图片生成与编辑工具 |
| `antigravity-video` | `dsh-antigravity-auth/video` | 视频理解工具 |

## Wire Identity（线路身份）

Wire Identity 模块保留 Antigravity 专有 header，并调用 DSH 公开的 `attributionHeaders()` formatter，把真实 DSH 身份放入二级 carrier：

```text
X-DeepSeek-Harness-Attribution: deepseek-harness/<version> (+repository-url)
```

请求端点由代码固定：仅接受受信任的 HTTPS Antigravity origin 与枚举的 `v1internal:` 操作路径。

## 安全与限制

- token 值绝不进入前端、设置、日志、会话事件或工具 metadata，仅在 Host 侧发起私有请求时附带认证 header。
- auth、gate evidence 与受控 live image 文件在 POSIX 上严格校验属主 mode；Windows 由 ACL 管理访问权限，因此不把合成的 POSIX group/other bits 作为访问判据，但仍执行 symlink、文件类型、大小、schema 与内容校验。
- 严格单账号模式：不提供账号池、轮换、身份回退或账号切换。
- 本地登出立即清除 Host 内存与本地存储。
- RPC 状态与登录通道仅限本机 loopback 访问。
- 原始多媒体 base64 绝不注入会话正文或前端 RPC。

## 本地开发

```sh
pnpm install
pnpm peers check
pnpm test
pnpm run check
```

`pnpm run build` 生成：

- `lib/index.js`：认证 / LLM Host 插件；
- `lib/search.js`：搜索 Host 插件；
- `lib/image.js`：图片 Host 插件；
- `lib/video.js`：视频 Host 插件；
- `lib/quota.js`：配额 Host 插件；
- `lib/wire-identity.js`：Wire Identity 线路身份模块；
- `lib/client.cjs`：浏览器设置端插件；
- `lib/types/**`：TypeScript 类型声明。

## 友情链接

- [LINUX DO (L 站)](https://linux.do/)
