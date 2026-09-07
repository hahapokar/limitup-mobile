#!/usr/bin/env bash
set -e

COMMIT_MSG="${1:-"update: $(date +'%Y-%m-%d %H:%M')"}"

echo "📦 [1/5] 构建前端..."
npm run build >/dev/null 2>&1 || { echo "❌ npm run build 失败"; exit 1; }

echo "📂 [2/5] 同步 build 产物到 public/ 和 docs/..."
# Step 1: 把 build 产物覆盖到 public/（保留 public/snapshots 等数据）
cp -R dist/. public/
rm -f public/server.cjs public/server.cjs.map
# Step 2: docs/ 是 GitHub Pages 源。先用 dist 全新构建，再叠加 public 的 snapshots
rm -rf docs
mkdir -p docs
cp -R dist/. docs/
cp -R public/snapshots docs/ 2>/dev/null || true
cp -R public/snapshot.json docs/ 2>/dev/null || true

echo "📦 [3/5] 暂存修改..."
git add .

if git diff --cached --quiet; then
    echo "ℹ️  没有检测到需要 commit 的代码改动，准备拉取更新..."
else
    echo "📝 [4/5] 提交修改: \"$COMMIT_MSG\""
    git commit -m "$COMMIT_MSG"
fi

echo "🔄 [5/5] 拉取云端机器人最新快照并 Rebase + Push..."
git fetch origin main
git rebase origin/main
git push origin main

echo "🎉 同步与推送完成！GitHub Pages 约 30 秒内自动更新。"

