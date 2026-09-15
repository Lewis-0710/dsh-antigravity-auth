#!/usr/bin/env bash
#==============================================================================
# sync.sh — dsh-antigravity-auth 上游同步脚本
#==============================================================================
#
# 功能：
#   将本地修改同步到上游最新代码。采用 **Patch-First, Merge-Fallback** 双策略：
#   优先用 patch 方案保持干净的线性历史；若 patch 冲突则回退到 merge -X ours。
#
# 作用范围：
#   - 仅针对当前仓库（dsh-antigravity-auth）
#   - 需要 remote 配置：upstream（原上游）、origin（你的 fork）
#   - 需要分支：custom（本地修改）、main（跟踪 upstream/main）
#   - 需要文件：sync.patch（本地修改的快照）
#
# 实现策略（Patch-First, Merge-Fallback）：
#
#   ── 策略 1：Patch Apply（优先）──────────────────────────────
#   适用场景：上游修改的文件与本地修改的文件没有行级冲突
#   优点：保持线性历史，不会产生 merge commit，与上游结构一致
#
#   步骤：
#     1. git checkout main && git reset --hard upstream/main  — main 回到上游最新
#     2. git checkout -b custom-new main                        — 从上游最新创建临时分支
#     3. git apply sync.patch                                   — 应用本地修改快照
#     4. 成功 → git branch -f custom custom-new && git checkout custom
#
#   ── 策略 2：Merge -X ours（回退）──────────────────────────────
#   适用场景：patch 失败（上游和本地修改了同一文件的同一区域）
#   优点：不会中断同步，自动保留本地修改
#
#   步骤：
#     1. git checkout custom
#     2. git merge main -X ours --no-edit                       — 合并上游，冲突本地优先
#     3. 清理 custom-new 临时分支
#
#   最终步骤（两种策略共用）：
#     5. 重新生成 sync.patch（git diff upstream/main...custom）
#     6. git push origin custom
#
# 为什么 Patch-First：
#   - 线性历史更干净，不会积累 merge commit
#   - 与上游结构一致，便于后续向上游提 PR 或对比差异
#   - 只有真正冲突时才回退到 merge
#
# 为什么需要 Merge-Fallback：
#   - patch 是行级 diff，如果上游修改了本地也改过的同一区域，patch 会失败
#   - merge -X ours 可以自动解决此类冲突，保证同步不中断
#
# 后续扩展：
#   - 新增本地修改后，先 commit 到 custom 分支，再运行本脚本
#   - 如果 patch 文件过期，策略 1 会自动失败并回退到策略 2
#   - 要在新机器重建：clone → git checkout -b custom → git apply sync.patch
#
#==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

REPO_NAME="$(basename "$SCRIPT_DIR")"
PATCH_FILE="$SCRIPT_DIR/sync.patch"

echo "=== 同步 $REPO_NAME (Patch-First, Merge-Fallback) ==="

# Step 1: 拉取上游最新
echo "[1/4] 拉取上游最新代码..."
git fetch upstream

# Step 2: 重置 main 到上游最新
echo "[2/4] 重置 main 到 upstream/main..."
git checkout main
git reset --hard upstream/main

# Step 3: 尝试 Patch Apply（策略 1）
echo "[3/4] 尝试 Patch Apply..."
git checkout -b custom-new main

if git apply --check "$PATCH_FILE" 2>/dev/null; then
    # Patch 可以无冲突应用
    git apply "$PATCH_FILE"
    # 将 custom 指向新的干净历史
    git branch -f custom custom-new
    git checkout custom
    # 清理临时分支
    git branch -D custom-new 2>/dev/null || true
    echo "✅ Patch 应用成功（策略 1：线性历史）"
else
    # Patch 冲突，回退到策略 2
    echo "⚠️  Patch 存在冲突，回退到 Merge -X ours..."
    git checkout custom
    git branch -D custom-new 2>/dev/null || true

    echo "[3/4] 合并 upstream/main（冲突以本地优先）..."
    if git merge main -X ours -m "merge: sync upstream/main $(date +%Y-%m-%d)" --no-edit 2>/dev/null; then
        echo "✅ Merge 成功（策略 2：冲突本地优先）"
    else
        echo "⚠️  合并出现冲突，自动解决..."
        git add -A
        git commit -m "merge: sync upstream/main (auto-resolved)"
    fi
fi

# Step 4: 重新生成 patch
echo "[4/4] 重新生成 sync.patch..."
git diff upstream/main...custom > "$PATCH_FILE"
echo "✅ sync.patch 已更新 ($(wc -l < "$PATCH_FILE") 行)"

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