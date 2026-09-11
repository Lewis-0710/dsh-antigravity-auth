#!/bin/bash
# DSH OAuth Wrapper for Antigravity Language Server
# 拦截语言服务器的启动，注入 DSH 的 OAuth 客户端凭据
#
# 此脚本由 antigravity-auth-wrapper.sh 调用（通过 CODEIUM_LANGUAGE_SERVER_BIN）
# 它接收原始语言服务器的所有参数，并添加 OAuth 覆盖参数

set -e

# 获取 DSH OAuth 凭据
DSH_CLIENT_ID="${DSH_OAUTH_CLIENT_ID:-}"
DSH_CLIENT_SECRET="${DSH_OAUTH_CLIENT_SECRET:-}"
ANTIGRAVITY_OAUTH_CONFIG_DIR="${ANTIGRAVITY_OAUTH_CONFIG_DIR:-$HOME/.gemini/antigravity-cli}"

# 如果环境变量未设置，尝试从 DSH auth-core 获取
if [ -z "$DSH_CLIENT_ID" ] || [ -z "$DSH_CLIENT_SECRET" ]; then
    DSH_CLIENT_ID=$(node -e "console.log(require('@cortexkit/antigravity-auth-core').ANTIGRAVITY_CLIENT_ID)" 2>/dev/null)
    DSH_CLIENT_SECRET=*** -e "console.log(require('@cortexkit/antigravity-auth-core').ANTIGRAVITY_CLIENT_SECRET)" 2>/dev/null)
fi

if [ -z "$DSH_CLIENT_ID" ] || [ -z "$DSH_CLIENT_SECRET" ]; then
    echo "ERROR: 无法获取 DSH OAuth 凭据" >&2
    exit 1
fi

# 原始语言服务器路径
ORIGINAL_LS="/Applications/Antigravity.app/Contents/Resources/bin/language_server"

if [ ! -f "$ORIGINAL_LS" ]; then
    echo "ERROR: 原始语言服务器不存在: $ORIGINAL_LS" >&2
    exit 1
fi

echo "=== LS Wrapper: 注入 DSH OAuth 凭据 ===" >&2
echo "  Client ID: $DSH_CLIENT_ID" >&2
echo "  Client Secret: ***" >&2
echo "" >&2

# 收集所有传入的参数
ARGS=()
while [[ $# -gt 0 ]]; do
    ARGS+=("$1")
    shift
done

# 注入 OAuth 覆盖参数（如果用户没有显式提供）
if [[ ! " ${ARGS[@]} " =~ --override_oauth_client_id ]]; then
    ARGS+=(--override_oauth_client_id="$DSH_CLIENT_ID")
fi
if [[ ! " ${ARGS[@]} " =~ --override_oauth_client_secret ]]; then
    ARGS+=(--override_oauth_client_secret="$DSH_CLIENT_SECRET")
fi

# 如果存在 DSH 的 refresh token，传递给语言服务器（如果它接受的话）
if [ -f "$ANTIGRAVITY_OAUTH_CONFIG_DIR/oauth_config.json" ]; then
    echo "  使用保存的 OAuth 配置: $ANTIGRAVITY_OAUTH_CONFIG_DIR/oauth_config.json" >&2
fi

echo "  启动参数: ${ARGS[*]}" >&2
echo "" >&2

# 执行原始语言服务器
exec "$ORIGINAL_LS" "${ARGS[@]}"
