#!/usr/bin/env bash
#==============================================================================
# sync.sh — dsh-antigravity-auth 上游同步脚本
#==============================================================================
#
# 功能：
#   将本地修改同步到上游最新代码。采用 **Patch-First, Smart-Merge** 策略：
#   优先用 patch 方案保持干净的线性历史；若 patch 冲突则按文件类型智能处理。
#
# 作用范围：
#   - 仅针对当前仓库（dsh-antigravity-auth）
#   - 需要 remote 配置：upstream（原上游）、origin（你的 fork）
#   - 需要分支：custom（本地修改）、main（跟踪 upstream/main）
#   - 需要文件：sync.patch（本地修改的快照）
#
# 实现策略（Patch-First, Smart-Merge）：
#
#   ── 策略 1：Patch Apply（优先）──────────────────────────────
#   步骤：
#     1. git checkout main && git reset --hard upstream/main
#     2. git checkout -b custom-new main
#     3. git apply sync.patch
#     4. git branch -f custom custom-new && git checkout custom
#
#   ── 策略 2：Smart Merge（回退，按文件类型处理）──────────────
#   README 文件（README*.md）：
#     - 保持本地头部的 Fork 维护说明（> [!NOTE] 块）
#     - 其余部分全部使用上游版本
#
#   其他文件：
#     - 列出上游与本地的具体差异
#     - 冲突以本地优先（-X ours）
#
#==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

REPO_NAME="$(basename "$SCRIPT_DIR")"
PATCH_FILE="$SCRIPT_DIR/sync.patch"

echo "=== 同步 $REPO_NAME (Patch-First, Smart-Merge) ==="

# Step 1: 拉取上游最新
echo "[1/4] 拉取上游最新代码..."
git fetch upstream

# Step 1.5: 暂存本地未提交的修改
echo "[1.5] 暂存本地未提交修改..."
STASHED=false
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    git stash push -m "sync.sh auto-stash" -- sync.patch sync.sh 2>/dev/null || true
    STASHED=true
fi

# Step 2: 重置 main 到上游最新
echo "[2/4] 重置 main 到 upstream/main..."
git checkout main
git reset --hard upstream/main

# Step 3: 尝试 Patch Apply（策略 1）
echo "[3/4] 尝试 Patch Apply..."
git checkout -b custom-new main

if git apply --check "$PATCH_FILE" 2>/dev/null; then
    git apply "$PATCH_FILE"
    git branch -f custom custom-new
    git checkout custom
    git branch -D custom-new 2>/dev/null || true
    echo "✅ Patch 应用成功（策略 1：线性历史）"
else
    # Patch 冲突，进入策略 2
    echo "⚠️  Patch 存在冲突，进入 Smart Merge..."
    git checkout custom
    git branch -D custom-new 2>/dev/null || true

    echo "[3/4] Smart Merge 处理冲突..."

    # 先执行 merge 获取冲突列表，但不提交
    git merge main --no-commit --no-ff 2>/dev/null || true

    # 获取冲突文件列表
    CONFLICTS=$(git diff --name-only --diff-filter=U 2>/dev/null || true)

    if [ -z "$CONFLICTS" ]; then
        git add -A
        git commit -m "merge: sync upstream/main $(date +%Y-%m-%d)" 2>/dev/null || true
    else
        for f in $CONFLICTS; do
            case "$f" in
                README*|readme*)
                    echo ""
                    echo "📄 $f — README 文件：保持 Fork 说明 + 其余使用上游版本"
                    FORK_HEADER=$(awk '/^> \[!NOTE\]/{p=1} p{print} /^$/{if(p)exit}' "$f" 2>/dev/null || true)
                    if [ -n "$FORK_HEADER" ]; then
                        git show "upstream/main:$f" > "$f.upstream"
                        printf '%s\n' "$FORK_HEADER" > "$f.header"
                        cat "$f.header" "$f.upstream" > "$f"
                        rm -f "$f.upstream" "$f.header"
                        echo "   ✅ Fork 说明已保留，其余使用上游版本"
                    else
                        git checkout upstream/main -- "$f"
                        echo "   ✅ 无 Fork 说明，使用上游版本"
                    fi
                    git add "$f"
                    ;;
                *)
                    echo ""
                    echo "📄 $f — 其他冲突文件"
                    echo "   ┌─ 上游修改（upstream/main）："
                    git show "upstream/main:$f" 2>/dev/null | head -30 | diff - "$f" 2>/dev/null | head -20 | sed 's/^/   │ /' || true
                    echo "   └─ 本地版本优先（ours）"
                    git checkout --ours "$f"
                    git add "$f"
                    ;;
            esac
        done

        git add -A
        git commit -m "merge: sync upstream/main (smart merge, $(date +%Y-%m-%d))" 2>/dev/null || true
        echo "✅ Smart Merge 完成"
    fi
fi

# 恢复暂存的修改
if [ "$STASHED" = true ]; then
    git stash pop 2>/dev/null || true
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
