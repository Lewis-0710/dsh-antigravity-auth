# Release 发布规范

本规范适用于 `dsh-antigravity-auth` 的后续发布。标题、章节、顺序和字段采用固定格式，具体变更内容从已合入的代码、CHANGELOG 和本次验证结果提取。正文从 [Release 模板](release-notes.template.md) 填写。

## 1. 版本、标题与通道

| 对象 | 固定格式 | 示例 |
| --- | --- | --- |
| package.json / npm 版本 | 不带 `v` 的版本号 | `0.1.4-rc.3` |
| Git tag | `v<版本号>`，使用 annotated tag | `v0.1.4-rc.3` |
| GitHub Release 标题 | `<package.name> v<版本号>` | `dsh-antigravity-auth v0.1.4-rc.3` |
| 安装包附件 | `<package.name>-<版本号>.tgz` | `dsh-antigravity-auth-0.1.4-rc.3.tgz` |

标题只包含包名和版本号，不追加变更主题、日期、emoji 或宣传语。变更主题放在 Highlights 和中文说明中。版本以 `package.json` 为准，tag、Release、npm、README、CHANGELOG 和安装命令必须一致。

| 版本类型 | npm dist-tag | GitHub Pre-release | GitHub Latest |
| --- | --- | --- | --- |
| `X.Y.Z-alpha.N` | `alpha` | 是 | 否 |
| `X.Y.Z-beta.N` | `beta` | 是 | 否 |
| `X.Y.Z-rc.N` | `rc` | 是 | 否 |
| 当前主线正式版 `X.Y.Z` | `latest` | 否 | 是 |

在既有预发布线上发布修复时，递增该线的序号；不因发布完成而自动把 RC 改为正式版。维护旧分支时，按明确指定的通道发布，不覆盖更新主线的 `latest`。其它版本后缀必须先确定对应通道，不猜测映射。

Pre-release 是已公开发布的候选版本，Draft 才是草稿。交付时必须分别说明公开状态和通道；不能用“不是 Latest”解释成“尚未发布”。

## 2. 正文结构

正文不重复一级标题。顶部固定为版本、通道、DSH 基线、npm 链接四行信息表，之后按以下顺序保留五个二级标题，最后附完整变更链接：

```text
## Highlights
## 中文说明
## Install / 安装
## Verification / 验证
## Checksums / 校验值
**Full Changelog / 完整变更:** ...
```

| 部分 | 内容规则 |
| --- | --- |
| Highlights | 1–5 条英文变更，先写影响最大的修复或功能。每条描述用户遇到的触发条件及变化后的行为，必要时附 issue / PR 链接。 |
| 中文说明 | 与英文条目数量、顺序和事实逐条对应，不省略兼容性变化、限制或迁移动作。 |
| Install / 安装 | 先写兼容基线及升级动作，再给精确 npm 版本和 Release 附件两种安装命令。默认示例使用 Web profile，并注明应替换为实际 profile。 |
| Verification / 验证 | 分别记录完整检查、对应 DSH 源码包检查、真实环境验证范围和发布制品一致性。统计来自本次日志，不能沿用旧数字；未运行项明确写未运行及原因。 |
| Checksums / 校验值 | 文件名、字节数、文件数，以及 SHA-1、SHA-256、SHA-512 integrity，全部从同一份最终 tarball 计算。 |
| Full Changelog / 完整变更 | 比较本次 tag 与最近一个属于当前发布历史的已发布祖先 tag；RC 的连续发布通常比较前一个 RC。首次发布链接到该 tag 的提交历史。 |

变更条目只写本次比较范围内的内容，不直接粘贴长篇 commit 日志、评审过程或内部排障记录。破坏性变化和必需迁移必须进入两种语言的首条或前几条变更，并在安装部分给出操作。无变更的基线统一放入顶部信息表。

正文使用可点击链接和带 `sh` 标记的命令块；正文保留真实换行，不把换行符转义成可见文本。模板中的 `{{...}}` 必须全部替换。不要新增同义章节、把校验值改成普通加粗段落，或让同一事实散落在多个位置。

## 3. 填写模板

模板变量来自以下证据，不从旧 Release 盲目复制：

- `PACKAGE`、`VERSION`：当前 `package.json`；`TAG` 固定为 `v` 加 `VERSION`。
- `NPM_TAG`、`RELEASE_KIND`：上面的通道表；类型文本固定为 `Prerelease / 预发布` 或 `Stable / 正式版`。
- `DSH_BASELINE`：当前兼容性文档和实际验证的依赖图。若支持多个分别验证的基线，全部列出并说明不能混装。
- `HIGHLIGHTS_EN`、`HIGHLIGHTS_ZH`：包含 `- ` 的完整条目列表，两种语言逐条对应。
- `UPGRADE_NOTES_EN`、`UPGRADE_NOTES_ZH`：停止 Host、更新目标 profile、重启，以及本次额外迁移动作；没有额外动作时也保留基本升级说明。
- `TEST_FILES`、`TESTS`、`SOURCE_VERIFICATION_EN/ZH`、`LIVE_VERIFICATION_EN/ZH`：实际检查日志和授权验证结果。源码检查若复用同一修复的既有结果，写明验证固定点和范围，不描述成当前版本重新运行。
- `FILENAME`、`BYTES`、`FILE_COUNT`、三个 hash 字段：本次固定 tarball 的元数据。
- `CHANGELOG_LABEL`、`CHANGELOG_URL`：通常为 `上一个 tag...本次 tag` 及 GitHub compare URL；首次发布使用本次 tag 和对应 commits URL。

仓库和安装命令已固定在模板内。本规范当前只管理本仓库，不改变相邻插件的发布约定。

## 4. 发布顺序

1. 确认本次发布授权、仓库、分支、工作区和远端状态。既有明确授权继续有效，不重复询问常规步骤。
2. 准备版本、CHANGELOG、中英文 README 和模板正文，核对变更范围；运行 `pnpm run check`，兼容性变更还须运行 [对应源码包检查](dsh-source-verification.md)。
3. 提交最终源码与版本信息，生成 annotated tag；冻结唯一一份发布 tarball，记录文件列表和校验值，对该 tarball 执行 dry-run。检查内部产生的临时测试包不是发布制品；发布制品生成后不重新打包替换。
4. 将源码与 tag 推送至远端并核对 SHA。创建 GitHub Release 草稿，使用固定标题、填好的正文和同一 tarball 附件，按通道显式设置 Pre-release / Latest；检查 GitHub 渲染后的标题、列表、链接、命令块及中英文内容。
5. 按工作区的 npm Passkey 发布流程（相对仓库根目录 `../.agents/skills/npm-publish-with-passkey/SKILL.md`）发布同一 tarball，显式指定对应 dist-tag。验证 registry 中的版本、dist-tag、SHA-1、integrity，并下载比对字节。该工作区 skill 路径用于本地发布操作，不作为公开 Release 正文链接。
6. 将 GitHub Release 从草稿转为公开，回读并核对标题、正文、通道、发布时间和附件；通过未登录页面或 API 确认公开可见，再下载附件比对字节。按已有授权补充相关 issue 的版本说明。

步骤中的草稿是准备状态，不是任务完成。npm 需要用户验证时，保持当前发布进程，并准确说明已经完成的项目和等待的操作；不要重新启动相同版本的发布。registry 传播延迟只重试查询，不重试 publish。已有 npm 版本和已推送 tag 不覆盖；部分成功时保留事实，继续补齐缺失项目。

## 5. 完成标准与交付格式

只有下列项目全部核验成功，才能报告“发布完成”：

- 代码和 annotated tag 已在目标远端，tag 指向预期发布提交。
- GitHub Release 标题、正文符合模板，`draft=false`，通道正确，未登录可访问，附件完整。
- npm 目标版本存在，预期 dist-tag 正确，registry 校验值匹配。
- npm 下载包、GitHub 下载附件与本次唯一发布制品逐字节一致。
- 发布说明没有未替换变量、失效的安装版本或凭空声称的验证结果。

最终回复固定先给包名与版本，再用表格分别报告 `代码`、`Git tag`、`GitHub Release`、`npm` 四项结果和链接，随后给精确安装命令、检查结果及重要限制。报告 Pre-release 时同时写明它已公开；不能仅给 tag 链接代替 Release 链接。

保留提交、校验值、检查日志和发布核验记录；核验完成后按 npm skill 清理临时 tarball、dry-run 捕获和已完成进程。凭据和一次性认证 URL 不进入这些记录。

## 6. 文档维护

今后调整格式时同步更新本规范与模板，避免每次发布临时设计格式。本规范的制定本身不修改历史 Release，也不触发重新发布。若另行统一历史说明，仅修改已授权的标题与正文，保留原 tag、发布制品、校验值和历史验证事实；缺少的证据写明未记录，不补造测试或实测结果。
