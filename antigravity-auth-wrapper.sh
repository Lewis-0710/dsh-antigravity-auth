#!/bin/bash
# DSH Antigravity OAuth Token Injector (Variant A1: Override OAuth Client Only)
# 用 DSH 的 OAuth 客户端凭据覆盖语言服务器的默认凭据
# 语言服务器会启动自己的 OAuth 流程，用户在浏览器中 completing 授权

set -e

DSH_AUTH_DIR="$HOME/.local/share/dsh-antigravity-auth"
ANTIGRAVITY_BIN="/Applications/Antigravity.app/Contents/Resources/bin/language_server"
OAUTH_CONFIG_DIR="$HOME/.gemini/antigravity-cli"

# 从 DSH auth-core 获取 OAuth 凭据
DSH_CLIENT_ID=$(node -e "console.log(require('@cortexkit/antigravity-auth-core').ANTIGRAVITY_CLIENT_ID)" 2>/dev/null)
DSH_CLIENT_SECRET=*** -e "console.log(require('@cortexkit/antigravity-auth-core').ANTIGRAVITY_CLIENT_SECRET)" 2>/dev/null)

if [ -z "$DSH_CLIENT_ID" ] || [ -z "$DSH_CLIENT_SECRET" ]; then
    echo "ERROR: 无法从 DSH auth-core 获取 OAuth 凭据"
    exit 1
fi

echo "=== DSH OAuth 客户端凭据 ==="
echo "Client ID: $DSH_CLIENT_ID"
echo "Client Secret: $DSH_CLIENT_SECRET"
echo ""

if [ ! -f "$ANTIGRAVITY_BIN" ]; then
    echo "ERROR: 语言服务器二进制文件不存在: $ANTIGRAVITY_BIN"
    exit 1
fi

# 确保 OAuth 配置目录存在
mkdir -p "$OAUTH_CONFIG_DIR"

# 如果有 DSH 的 refresh token，保存到 Antigravity 可能读取的位置
if [ -f "$DSH_AUTH_DIR/auth.json" ]; then
    REFRESH_TOKEN=$(node -e "
        const fs = require('fs');
        const data = JSON.parse(fs.readFileSync('$DSH_AUTH_DIR/auth.json', 'utf8'));
        const account = data.accounts.find(a => a.id === data.activeAccountId) || data.accounts[0];
        console.log(account.refreshToken);
    " 2>/dev/null)
    
    if [ -n "$REFRESH_TOKEN" ]; then
        echo "=== DSH Refresh Token (可选) ==="
        echo "账号: $(node -e "const d=JSON.parse(require('fs').readFileSync('$DSH_AUTH_DIR/auth.json','utf8')); console.log(d.activeAccountId || d.accounts[0].id)")"
        
        # 保存 refresh token + OAuth 凭据供语言服务器可能使用
        cat > "$OAUTH_CONFIG_DIR/oauth_config.json" << EOF
{
  "refresh_token": "$REFRESH_TOKEN",
  "client_id": "$DSH_CLIENT_ID",
  "client_secret": "$DSH_CLIENT_SECRET"
}
EOF
        echo "OAuth 配置已保存: $OAUTH_CONFIG_DIR/oauth_config.json"
        echo ""
    fi
fi

echo "=== 启动 Antigravity (覆盖 OAuth 客户端) ==="
echo "Language Server 将使用以下覆盖参数启动:"
echo "  --override_oauth_client_id=$DSH_CLIENT_ID"
echo "  --override_oauth_client_secret=***"
echo ""

# 设置环境变量，让 Antigravity 主进程知道使用自定义语言服务器
export CODEIUM_LANGUAGE_SERVER_BIN="$(pwd)/ls-wrapper.sh"
export DSH_OAUTH_CLIENT_ID="$DSH_CLIENT_ID"
export DSH_OAUTH_CLIENT_SECRET="$DSH_CLIENT_SECRET"
export ANTIGRAVITY_OAUTH_CONFIG_DIR="$OAUTH_CONFIG_DIR"

# 启动 Antigravity
open /Applications/Antigravity.app

echo "Antigravity 已启动。"
echo "语言服务器会使用 DSH 的 OAuth 客户端凭据启动 OAuth 流程。"
echo "请在浏览器弹窗中 completing 授权。"
