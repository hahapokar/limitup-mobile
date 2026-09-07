#!/usr/bin/env bash
set -e

COMMIT_MSG="${1:-"update: $(date +'%Y-%m-%d %H:%M')"}"

echo "📦 [1/5] 构建前端..."
npm run build >/dev/null 2>&1 || { echo "❌ npm run build 失败"; exit 1; }

echo "📂 [2/5] 同步 public + dist 到 docs (GitHub Pages 源)..."
rm -rf docs
mkdir -p docs
# 复制 build 产物（含 index.html + assets/）
cp -R dist/. docs/
# 复制 public 里的 snapshot 数据 + 静态资源（如有覆盖则覆盖）
cp -R public/. docs/
# server.cjs 是 Cloudflare Worker / 本地 dev 用，Pages 不需要
rm -f docs/server.cjs docs/server.cjs.map

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

