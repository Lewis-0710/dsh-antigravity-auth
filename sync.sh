#!/usr/bin/env bash
#==============================================================================
# sync.sh — dsh-antigravity-auth 上游同步脚本
#==============================================================================
#
# 功能：
#   将当前 custom 分支与上游 main 分支合并，采用 Patch Rebase 方案：
#   先重置到上游最新，再 rebase 本地修改，若有冲突则手动解决。
#
# 作用范围：
#   - 仅针对当前仓库（dsh-antigravity-auth）
#   - 需要 remote 配置：upstream（原上游）、origin（你的 fork）
#   - 需要分支：custom（本地修改）、main（跟踪 upstream/main）
#
# 实现策略（Patch Rebase 方案）：
#   1. git fetch upstream — 拉取上游最新
#   2. git checkout main && git reset --hard upstream/main — 重置 main 到上游最新
#   3. git checkout custom — 切回 custom 分支
#   4. git rebase main — 将本地修改 rebase 到上游最新之上
#      - 如果 patch 应用失败（冲突）：
#        a. 暂停，提示手动解决冲突
#        b. 解决后 git add . && git rebase --continue
#        c. 或者 git rebase --abort 放弃本次同步
#   5. 重新生成 sync.patch
#   6. git push --force-with-lease origin custom — 同步到你的 fork
#
# 为什么用 patch 方案而非 -X ours：
#   -X ours 会静默丢弃上游对同一行的修改，导致有用的上游更新丢失
#   patch rebase 方案：
#     - 上游无冲突的修改自动合并
#     - 有冲突时暂停，由你决定保留哪些修改
#     - 合并后可以重新生成 patch，确保 patch 文件永远可用
#
# 后续扩展：
#   - 新增本地修改后，先 commit 到 custom 分支，再运行本脚本
#   - 如果 patch 文件过期，运行 ./sync.sh 会自动重新生成
#   - 要在新机器重建：clone → git checkout -b custom → git apply sync.patch
#
#==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

REPO_NAME="$(basename "$SCRIPT_DIR")"

echo "=== 同步 $REPO_NAME (Patch Rebase 方案) ==="

# Step 1: 拉取上游最新
echo "[1/5] 拉取上游最新代码..."
git fetch upstream

# Step 2: 重置 main 到上游最新
echo "[2/5] 重置 main 到 upstream/main..."
git checkout main
git reset --hard upstream/main

# Step 3: 切回 custom 分支
echo "[3/5] 切换到 custom 分支..."
git checkout custom

# Step 4: Rebase 到 main（本地修改应用到上游最新之上）
echo "[4/5] Rebase custom 到 main（自动应用本地修改）..."
if git rebase main; then
    echo "✅ Rebase 成功，本地修改已应用到上游最新"

    # 重新生成 patch
    echo "[5/5] 重新生成 sync.patch..."
    git diff upstream/main...custom > "$SCRIPT_DIR/sync.patch"
    echo "✅ sync.patch 已更新 ($(wc -l < "$SCRIPT_DIR/sync.patch") 行)"

    # 推送到 fork
    read -p "是否推送到 origin/custom? [y/N] " -n 1 -r < /dev/tty
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push --force-with-lease origin custom
        echo "✅ 已推送到 origin/custom"
    else
        echo "跳过推送"
    fi
else
    echo "❌ Rebase 冲突！请手动解决冲突后运行:"
    echo "   git add . && git rebase --continue"
    echo ""
    echo "   # 解决后重新生成 patch:"
    echo "   git diff upstream/main...custom > sync.patch"
    echo ""
    echo "   或者放弃本次同步: git rebase --abort"
    exit 1
fi

echo "=== $REPO_NAME 同步完成 ==="
