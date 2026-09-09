# dsh-antigravity-auth

> **DSH 兼容性（未发布的开发版本）：** 当前检出版本以 `0.1.5-alpha.1` 为开发与最低支持基线，依赖图必须保持一致。已发布的 alpha.6 不包含本次适配；旧 DSH 用户继续使用旧插件版本。见[验证说明](docs/dsh-source-verification.md)。

[![npm alpha version](https://img.shields.io/npm/v/dsh-antigravity-auth/alpha.svg?label=npm%20alpha)](https://www.npmjs.com/package/dsh-antigravity-auth)
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[English](README.md) | 中文

最近已发布版本：**v0.1.4-alpha.6**（适用于旧 DSH；本次适配尚未发布）。

这是一个自包含的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
**Antigravity 能力包**。它集成了 Antigravity 的私有 OAuth 登录态与 Wire Identity 线路身份，提供：

- `google-antigravity` LLM 路由（Gemini 3.8/3.7/3.6 Flash、Gemini 3.1 Pro、Claude Opus、Claude Sonnet、GPT-OSS）；
- 接入 DSH 内置 `web_search` 工具的全局 Antigravity 搜索提供方；
- 通过 `generate_image` 实现持久图片生成与编辑，并提供供模型使用的 `list_images` 目录；
- 支持本地工作区 MP4 文件的多模态 `analyze_video` 视频理解；
- 具备优雅动效的 5 小时与每周用量/配额可视化仪表盘；
- 一个原生 **Antigravity Auth** 设置分区，内含「登录」「网页搜索」「图片创作」「视频理解」四张卡片。

> **⚠️ 非官方通道——仅限个人开发。** 私有、受账户权限控制的 Antigravity
> 后端服务未获官方支持、可随时撤销，也可能在没有通知的情况下被限流或变更。请勿依赖它承载生产任务。

## 未发布：DSH 0.1.5 适配

开发基线升级到 DSH `0.1.5-alpha.1`。Gemini 与 Claude 将 V3 system message 文本保留到 `systemInstruction`；单次调用的 `options.system` 作为前置指令，后接按原顺序排列的系统消息。账号操作迁移到经过认证的 `/api/antigravity-auth/*`，保留原有静态 loopback 限制。终端命令名称不变。

## v0.1.4-alpha.5 重点更新

- 将开发依赖图与 peer 基线迁移到 DSH `0.1.2-alpha.5`，采用当前 Settings、Session、Connection、client injection 与 `ToolCallId` API；本仓库 lockfile 不含旧 DSH 包族。
- 新增经过登录态目录确认的 Gemini 3.8 Flash，默认 Medium，并使用抓取的 Low/Medium/High route、model enum 与 numeric thinking budget。
- 所有私有 Cloud Code `v1internal:` 操作重新对齐已审计的 AGY CLI 1.1.24 wire identity，同时保留强制、真实的 DSH 二级归因。
- 排空成功的 provider terminal SSE framing 与 body，并改用 cancellation-safe async-iterable Web Stream bridge，避免 Node `ERR_INVALID_STATE` 崩溃。
- 在 alpha.5 上保持账号 RPC fail-closed：只有明确绑定 `127.0.0.1` 的 Web Host 才能触达认证服务。

## 功能特性

### 共享 Antigravity 登录态

- LLM、搜索、图片、视频与配额操作共用一个仅运行于 Host 的认证协调器。
- 直连 OAuth 2.0 PKCE S256 流程：Host 内存生成 verifier 与 state 句柄，浏览器仅接收授权链接，密钥绝不跨越 Host 边界。
- 回调监听器仅绑定 `127.0.0.1:51121`，只接受一次性的已注册 code/state 凭据对。
- 通过属主权限文件存储（POSIX `0600`；Windows 用户数据目录 ACL）、短时内存缓存解析凭证，并在到期前主动刷新。
- 进程内合并并发刷新请求；仅在账号与 lineage 未变化时原子提交新 token。
- 仪表盘实时显示连接状态以及 Gemini 与 Claude/GPT 模型家族的 5 小时和每周额度进度条。
- `/antigravity-auth` 绝不向前端泄露 token。DSH alpha.5 下，真实账号 dispatcher 只在明确的 `127.0.0.1` Web bind 上启用；缺失、all-interface 或未知 bind 只能得到不含状态的安全拒绝。

### LLM 路由与模型发现

- 通过 DSH 公开的 `LlmAdapter` 接口注册 `google-antigravity` 提供方。
- 将已审计的 `@cortexkit/antigravity-auth-core@2.2.0` 固定社区模型快照与真实登录账号的可用模型取交集，并规范化服务端返回的 `gemini-3.8-flash-tiered` 目录别名；Gemini 3.8 Flash 使用 AGY 1.1.24 抓取的 Low/Medium/High wire route、numeric thinking budget、model enum、`userAgent` envelope 字段与 Medium 默认档位。
- 当真实模型发现暂时不可用或发生协议漂移时，DSH 内置模型选择器会回退到固定文本模型快照，设置页仍诚实显示 live catalog 状态；该 advisory 降级可能暂时保留 Gemini 3.5 Flash 等旧路由，而成功的 live intersection 会过滤账号目录中不存在的路由。成功但零交集的结果仍保持为空，未登录、授权拒绝、取消与明确的 attribution 拒绝仍保持 fail-closed。
- 流式传输支持首个数据块前的一次认证重放，并支持跨分片提供方函数名的 call-id 稳定关联；成功的 terminal event 会先排空剩余 SSE framing 再向 DSH 完成流，必要的取消路径则使用 Node 的 async-iterable Web Stream bridge，避开存在竞态的 `Readable.toWeb()` 适配器。

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

- DeepSeek Harness `0.1.5-alpha.1`（两套依赖图分别验证；直接 peer 接受这两条 prerelease 版本线）。
- Node.js `^22.19.0` 或 `>=24.0.0`。
- `PATH` 中可用 `pnpm`（本项目测试版本为 `11.7.0`）。
- 具有 Antigravity 权限的 Google 账号。

## 安装本次开发适配

本次改动尚未发布到 npm，不能通过安装已发布的 `0.1.4-alpha.6` 获得。在本插件检出目录构建并打包：

```sh
pnpm install --frozen-lockfile
pnpm run check
npm pack
```

先停止 `dsh web`，将目标 Host 升级到 DSH `0.1.5-alpha.1`，再将上一步实际生成的本地制品安装到需要升级的 profile：

```sh
dsh --version
dsh plugin --profile web add ./dsh-antigravity-auth-0.1.4-alpha.6.tgz
dsh plugin --profile web list
```

核对条目后重启 `dsh web` 并刷新浏览器。后续正式发布版本应使用其准确版本号；本次开发适配没有发布、修改现用 profile 或升级全局 DSH。旧 DSH 安装继续使用 [alpha.6 发布记录](https://github.com/suntianc/dsh-antigravity-auth/releases)。

## 终端登录命令

在提供 DSH `commands` 缝的交互界面上，本 bundle 会注册 `antigravity-auth` slash 命令，作为 Web 设置卡片的替代入口：

```text
/antigravity-auth            # 查看当前登录状态（默认）
/antigravity-auth login      # 启动 Google OAuth 授权流程
/antigravity-auth cancel     # 取消进行中的授权
/antigravity-auth logout     # 清除共享的 Antigravity 凭证
```

账户操作面向本地终端登录入口：在无 DSH WebServer、或显式绑定 `127.0.0.1` 的本地 Host 上执行；仅当 WebServer 在其它网卡上暴露共享的 `commands` 缝时，命令才会在不触碰认证服务的前提下被拒绝。账户 RPC 仍保留其更严格的 ADR-0008 守卫（真实 dispatcher 仅挂在显式 `127.0.0.1` bind 上）。

`login` 会确认非官方通道的风险提示，并启动 loopback OAuth 流程——其临时回调监听器绑定在 `127.0.0.1:51121`，与任何 DSH WebServer 相互独立。随后命令会用尽力而为的平台浏览器开启器打开 Google 登录页；授权链接**不会**被回显到命令结果中，因为 `CommandResult.text` 会被原样写入会话的 `command/done` 事件，而该链接携带 OAuth state 句柄与 PKCE challenge。在 Windows 上开启器为 `cmd /c start "" "<url>"`：URL 带引号且禁用 Node 的参数改写，因此以 `&` 分隔的每个 OAuth 参数都会完整到达浏览器。若开启器无法启动，命令会如实报告该失败且不复现 URL。请在浏览器中完成登录，然后运行 `/antigravity-auth status`。Token、verifier、授权码与回调 URL 绝不会出现在命令输出或会话日志中。DSH 未提供供插件使用的公开瞬时展示/浏览器唤起 API，因此在没有桌面浏览器的 Host 上，无法从终端完成交互式登录。

## Host 配置

能力包 patch 按依赖顺序启用独立的 Host 行：

| 行 | Export | 作用 |
|---|---|---|
| `antigravity-auth` | `dsh-antigravity-auth` | 共享认证协调器与 LLM 路由 |
| `antigravity-search` | `dsh-antigravity-auth/search` | 全局搜索提供方 |
| `antigravity-image` | `dsh-antigravity-auth/image` | 图片生成与编辑工具 |
| `antigravity-video` | `dsh-antigravity-auth/video` | 视频理解工具 |

## Wire Identity（线路身份）

Wire Identity 模块保留已审计的 AGY CLI 1.1.24 content-request User-Agent，并调用 DSH 公开的 `attributionHeaders()` formatter，把真实 DSH 身份放入强制二级 carrier：

```text
X-DeepSeek-Harness-Attribution: deepseek-harness/<version> (+repository-url)
```

请求端点由代码固定：仅接受受信任的 HTTPS Antigravity origin 与枚举的 `v1internal:` 操作路径。

## 安全与限制

- token 值绝不进入前端、设置、日志、会话事件或工具 metadata，仅在 Host 侧发起私有请求时附带认证 header。
- auth、gate evidence 与受控 live image 文件在 POSIX 上严格校验属主 mode；Windows 由 ACL 管理访问权限，因此不把合成的 POSIX group/other bits 作为访问判据，但仍执行 symlink、文件类型、大小、schema 与内容校验。
- 严格单账号模式：不提供账号池、轮换、身份回退或账号切换。
- 本地登出立即清除 Host 内存与本地存储。
- DSH alpha.5 不再提供逐 method 或 Host 侧 carrier authority。插件只在公开 WebServer bind 恰为 `127.0.0.1` 时启用真实 account RPC；缺失、all-interface 与未知 bind 只返回 `loopback-required`。浏览器在 `ConnectionHandle.isLoopback` 为 false 时也不会注册该设置分区，但该客户端提示仅用于 UX：在 DSH 提供对应 Host 侧事实前，owner-contained 自定义 carrier 仍不能获得授权。
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
