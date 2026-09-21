| Item / 项目 | Value / 内容 |
| --- | --- |
| Version / 版本 | `{{PACKAGE}}@{{VERSION}}` |
| Channel / 通道 | `{{NPM_TAG}}` · {{RELEASE_KIND}} |
| DSH baseline / DSH 基线 | `{{DSH_BASELINE}}` |
| npm | [{{PACKAGE}}@{{VERSION}}](https://www.npmjs.com/package/{{PACKAGE}}/v/{{VERSION}}) |

## Highlights

{{HIGHLIGHTS_EN}}

## 中文说明

{{HIGHLIGHTS_ZH}}

## Install / 安装

{{UPGRADE_NOTES_EN}}

{{UPGRADE_NOTES_ZH}}

The commands below use the Web profile; replace `web` with your actual profile. / 以下命令以 Web profile 为例，请将 `web` 替换为实际使用的 profile。

```sh
dsh plugin --profile web add --save-exact {{PACKAGE}}@{{VERSION}}
```

Or install the identical release artifact / 或安装同一份 Release 附件：

```sh
dsh plugin --profile web add https://github.com/suntianc/dsh-antigravity-auth/releases/download/{{TAG}}/{{FILENAME}}
```

## Verification / 验证

- `pnpm run check`: passed — **{{TEST_FILES}} test files / {{TESTS}} tests**, peer checks, lint, Host/client typecheck, build, package smoke and publint. / 完整检查通过：**{{TEST_FILES}} 个测试文件 / {{TESTS}} 项测试**，以及依赖、lint、Host/client 类型、构建、打包和 publint 检查。
- Source packages / 源码包：{{SOURCE_VERIFICATION_EN}} / {{SOURCE_VERIFICATION_ZH}}
- Live verification / 实际环境验证：{{LIVE_VERIFICATION_EN}} / {{LIVE_VERIFICATION_ZH}}
- npm and GitHub downloads were verified byte-for-byte against the same release tarball. / npm 下载包、GitHub 附件与同一份发布 tarball 已逐字节核对一致。

## Checksums / 校验值

Artifact / 文件：`{{FILENAME}}` · {{BYTES}} bytes / 字节 · {{FILE_COUNT}} files / 个文件

- SHA-1: `{{SHA1}}`
- SHA-256: `{{SHA256}}`
- SHA-512 integrity: `{{INTEGRITY}}`

**Full Changelog / 完整变更:** [{{CHANGELOG_LABEL}}]({{CHANGELOG_URL}})
