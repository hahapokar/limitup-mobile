#!/usr/bin/env bash
set -e

COMMIT_MSG="${1:-"update: $(date +'%Y-%m-%d %H:%M')"}"

echo "📦 [1/4] 暂存修改..."
git add .

if git diff --cached --quiet; then
    echo "ℹ️  没有检测到需要 commit 的代码改动，准备拉取更新..."
else
    echo "📝 [2/4] 提交修改: \"$COMMIT_MSG\""
    git commit -m "$COMMIT_MSG"
fi

echo "🔄 [3/4] 拉取云端机器人最新快照并 Rebase..."
git fetch origin main
git rebase origin/main

echo "⬆️  [4/4] 推送到 GitHub..."
git push origin main

echo "🎉 同步与推送完成！"
