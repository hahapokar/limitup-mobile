#!/bin/bash
# 进入项目目录
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")"

echo "========================================="
echo "  A股量化盯盘系统启动中 (Port: 3006)  "
echo "========================================="

# 1. 检查并强制清理/释放 3006 端口占用 (避免 Address already in use)
echo "[1/3] 检查并清理 3006 端口占用..."
if command -v fuser >/dev/null 2>&1; then
    fuser -k -n tcp 3006 >/dev/null 2>&1 || true
fi

if command -v lsof >/dev/null 2>&1; then
    PORT_PID=$(lsof -ti:3006 2>/dev/null)
    if [ -n "$PORT_PID" ]; then
        echo "  发现占用 3006 端口的旧进程 PID: $PORT_PID，正在终止..."
        kill -9 $PORT_PID >/dev/null 2>&1 || true
    fi
fi

# Python 兜底清理 3006 端口进程
python3 -c "
import os, signal, subprocess
try:
    res = subprocess.run(['lsof', '-ti:3006'], capture_output=True, text=True)
    pids = [int(p) for p in res.stdout.strip().split() if p.isdigit()]
    for p in pids:
        if p != os.getpid():
            os.kill(p, signal.SIGKILL)
except Exception:
    pass
" 2>/dev/null || true

echo "  3006 端口已就绪。"

# 2. 激活虚拟环境（若存在）
if [ -d "venv" ]; then
    echo "[2/4] 激活虚拟环境 (venv)..."
    source venv/bin/activate
fi

# 3. 模拟盘与缓存数据清理 (支持 ./start.sh --clean 或 CLEAN_DATA=1 自动重置)
if [ "$1" = "--clean" ] || [ "$1" = "-c" ] || [ "$CLEAN_DATA" = "1" ]; then
    echo "[3/4] 执行模拟盘账户与缓存数据清理..."
    python3 -c "
from quant_system.core.portfolio import portfolio_engine
res = portfolio_engine.reset_account(100000.0)
print('  [数据清理完成] 模拟盘已重置为 10 万元现金空仓待命，NAV: 1.0000')
"
else
    echo "[3/4] 保留当前模拟盘状态 (如需每次启动强制清空模拟盘数据，可运行: ./start.sh --clean)..."
fi

# 4. 准备访问地址提示（按当前网卡/Tailscale 实际状态打印，避免写死已失效的 IP）
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || true)
if [ -z "$LAN_IP" ]; then
    LAN_IP=$(python3 -c "import socket; s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('8.8.8.8',80)); print(s.getsockname()[0]); s.close()" 2>/dev/null || true)
fi

TS_IP=""
TS_RUNNING=0
if command -v tailscale >/dev/null 2>&1; then
    if tailscale status --self >/dev/null 2>&1 && ! tailscale status --self 2>/dev/null | grep -qi "stopped"; then
        TS_RUNNING=1
        TS_IP=$(tailscale ip -4 2>/dev/null | head -n 1)
    else
        TS_IP=$(tailscale ip -4 2>/dev/null | head -n 1)
    fi
fi

echo "[4/4] 启动服务与网络监听..."
echo "-----------------------------------------"
echo "  本地访问地址: http://localhost:3006"
if [ -n "$LAN_IP" ]; then
    echo "  局域网地址:     http://${LAN_IP}:3006"
fi
if [ "$TS_RUNNING" = "1" ] && [ -n "$TS_IP" ]; then
    echo "  Tailscale 地址: http://${TS_IP}:3006"
else
    echo "  Tailscale 未运行: 100.84.193.8:3006 现在不可达"
    echo "  需要跨设备访问时请先执行: tailscale up"
fi
echo "  提示: 首次拉行情约需数秒，端口就绪前浏览器会打不开"
echo "-----------------------------------------"

# 等 3006 真正开始监听后再打开浏览器（bootstrap 会先拉数据，固定 sleep 1.5s 会连拒绝）
open_when_ready() {
    local i=0
    while [ $i -lt 60 ]; do
        if lsof -nP -iTCP:3006 -sTCP:LISTEN >/dev/null 2>&1; then
            if command -v open >/dev/null 2>&1; then
                open "http://localhost:3006" >/dev/null 2>&1 || true
            elif command -v xdg-open >/dev/null 2>&1; then
                xdg-open "http://localhost:3006" >/dev/null 2>&1 || true
            fi
            return 0
        fi
        sleep 1
        i=$((i + 1))
    done
}

if [ -n "$DISPLAY" ] || [ "$(uname)" = "Darwin" ]; then
    (open_when_ready) &
fi

# 加载 nvm，保证非登录 shell 也能找到 node/npm
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "错误: 未找到 Node.js / npm。AI Studio 完整界面需要 Node。"
    echo "请先安装 Node，或执行: source ~/.nvm/nvm.sh"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "首次启动，正在安装前端依赖 (npm install)..."
    npm install
fi

# Python 常驻调度/拉数后台：15:30 自动生成当日情绪、四因子 TOP8 和 FINAL 快照。
echo "启动 Python 量化后台调度器..."
python3 app.py daemon &
PY_PID=$!
cleanup() {
    kill "$PY_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "启动 AI Studio 完整前端 (0.0.0.0:3006)..."
PORT=3006 npm run dev
