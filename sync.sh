#!/usr/bin/env bash
#==============================================================================
# sync.sh — dsh-antigravity-auth 上游同步脚本
#==============================================================================
#
# 功能：
#   将 custom 分支与上游 main 合并，本地修改优先保留。
#   本脚本采用 **Merge + Patch** 方案，比 rebase 更稳健，能处理历史中的 merge commit。
#
# 作用范围：
#   - 仅针对当前仓库（dsh-antigravity-auth）
#   - 需要 remote 配置：upstream（原上游）、origin（你的 fork）
#   - 需要分支：custom（本地修改）、main（跟踪 upstream/main）
#
# 实现策略（Merge + Patch 方案）：
#   1. git fetch upstream — 拉取上游最新
#   2. git checkout main && git reset --hard upstream/main — 重置 main 到上游最新
#   3. git checkout custom — 切回 custom 分支
#   4. git merge main -X ours -m "merge: sync upstream/main" — 合并上游，冲突以本地优先
#      - -X ours 策略：自动解决冲突，保留本地版本
#      - 上游无冲突的修改自动合并
#      - 有冲突时静默保留本地修改（这是预期行为）
#   5. 重新生成 sync.patch
#   6. git push origin custom — 同步到你的 fork
#
# 为什么用 merge 而非 rebase：
#   - 本仓库历史中包含 merge commit（如 `c8cf833 merge: sync upstream/main`），
#     rebase 无法正确处理此类历史，会导致冲突或重复应用修改
#   - merge + -X ours 更稳定，不会破坏历史结构
#
# 为什么用 patch 方案而非纯 -X ours：
#   - 本脚本只在上游有新增提交时才需要合并
#   - sync.patch 文件始终反映当前本地修改的精确差异
#   - 可以随时通过 git apply sync.patch 在新环境重建本地修改
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

echo "=== 同步 $REPO_NAME (Merge + Patch 方案) ==="

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

# Step 4: 合并上游，冲突以本地优先
echo "[4/5] 合并 upstream/main（冲突以本地优先）..."
if git merge main -X ours -m "merge: sync upstream/main $(date +%Y-%m-%d)" --no-edit; then
    echo "✅ 合并成功"
else
    echo "⚠️  合并出现冲突，尝试自动解决..."
    git add -A
    git commit -m "merge: sync upstream/main (auto-resolved)"
fi

# Step 5: 重新生成 patch
echo "[5/5] 重新生成 sync.patch..."
git diff upstream/main...custom > "$SCRIPT_DIR/sync.patch"
echo "✅ sync.patch 已更新 ($(wc -l < "$SCRIPT_DIR/sync.patch") 行)"

# 推送到 fork
read -p "是否推送到 origin/custom? [y/N] " -n 1 -r < /dev/tty
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    git push origin custom
    echo "✅ 已推送到 origin/custom"
else
    echo "跳过推送"
fi

echo "=== $REPO_NAME 同步完成 ==="