#!/bin/bash

set -u

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

detect_system_proxy() {
  if [ -n "${IMAGE_API_PROXY:-}" ] || ! command -v scutil >/dev/null 2>&1; then
    return
  fi

  local proxy_info enabled host port
  proxy_info="$(scutil --proxy 2>/dev/null)"
  enabled="$(printf "%s\n" "$proxy_info" | awk '/HTTPS?Enable/ && $3 == "1" { print "1"; exit }')"
  host="$(printf "%s\n" "$proxy_info" | awk '/HTTPS?Proxy/ { print $3; exit }')"
  port="$(printf "%s\n" "$proxy_info" | awk '/HTTPS?Port/ { print $3; exit }')"

  if [ "$enabled" = "1" ] && [ -n "$host" ] && [ -n "$port" ]; then
    export IMAGE_API_PROXY="http://$host:$port"
    printf "System network proxy detected.\n"
  fi
}

detect_system_proxy
if [ -n "${IMAGE_API_PROXY:-}" ]; then
  export HTTPS_PROXY="${HTTPS_PROXY:-$IMAGE_API_PROXY}"
  export HTTP_PROXY="${HTTP_PROXY:-$IMAGE_API_PROXY}"
fi

show_error() {
  local message="$1"
  printf "\n%s\n" "$message"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display dialog \"$message\" buttons {\"好\"} default button \"好\" with icon stop" >/dev/null 2>&1
  fi
}

if ! command -v node >/dev/null 2>&1; then
  show_error "没有找到 Node.js。请先安装 Node.js 20 或更高版本，然后重新双击本文件。"
  open "https://nodejs.org/" >/dev/null 2>&1
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null)"
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 20 ]; then
  show_error "Node.js 版本过低。请升级到 Node.js 20 或更高版本。"
  open "https://nodejs.org/" >/dev/null 2>&1
  exit 1
fi

if [ ! -d "$PROJECT_DIR/node_modules/pptxgenjs" ] || [ ! -d "$PROJECT_DIR/node_modules/undici" ]; then
  printf "First run: installing public dependencies...\n"
  if ! command -v npm >/dev/null 2>&1 || ! npm install; then
    show_error "依赖安装失败。请检查网络连接，然后重新双击本文件。"
    exit 1
  fi
fi

EXPECTED_VERSION="$(node -p "require('./package.json').version" 2>/dev/null)"
SELECTED_PORT=""
CANDIDATE_PORT=3210

while [ "$CANDIDATE_PORT" -le 3220 ]; do
  if ! nc -z 127.0.0.1 "$CANDIDATE_PORT" >/dev/null 2>&1; then
    SELECTED_PORT="$CANDIDATE_PORT"
    break
  fi

  RUNNING_HEALTH="$(curl -fsS --max-time 1 "http://127.0.0.1:$CANDIDATE_PORT/api/health" 2>/dev/null || true)"
  if [ "$CANDIDATE_PORT" -eq 3210 ] && \
     printf "%s" "$RUNNING_HEALTH" | grep -Fq '"service":"shengcai-mini-ppt"' && \
     ! printf "%s" "$RUNNING_HEALTH" | grep -Fq "\"version\":\"$EXPECTED_VERSION\""; then
    show_error "检测到旧版工具仍在使用 3210。请先关闭旧版的终端窗口，再重新双击新版。为了保留 API 配置和课件时光舱，新版不会自动切换端口。"
    exit 1
  fi
  if printf "%s" "$RUNNING_HEALTH" | grep -Fq '"service":"shengcai-mini-ppt"' && \
     printf "%s" "$RUNNING_HEALTH" | grep -Fq "\"version\":\"$EXPECTED_VERSION\""; then
    APP_URL="http://127.0.0.1:$CANDIDATE_PORT"
    printf "当前版本已经运行：%s\n" "$APP_URL"
    open "$APP_URL"
    exit 0
  fi

  CANDIDATE_PORT=$((CANDIDATE_PORT + 1))
done

if [ -z "$SELECTED_PORT" ]; then
  show_error "3210—3220 端口都被占用。请先关闭旧版工具，再重新双击启动。"
  exit 1
fi

export PORT="$SELECTED_PORT"
APP_URL="http://127.0.0.1:$SELECTED_PORT"

(
  attempt=0
  while [ "$attempt" -lt 80 ]; do
    if curl -fsS "$APP_URL/api/health" 2>/dev/null | grep -q '"service":"shengcai-mini-ppt"'; then
      open "$APP_URL"
      exit 0
    fi
    attempt=$((attempt + 1))
    sleep 0.25
  done
) &

printf "生财有术mini航海原创PPT课件正在启动...\n"
if [ "$SELECTED_PORT" -ne 3210 ]; then
  printf "3210 被其他程序占用，本次临时使用端口：%s\n" "$SELECTED_PORT"
  printf "保存在 3210 下的浏览器数据可能暂时不可见；关闭占用程序并重启后即可恢复。\n"
fi
printf "浏览器将自动打开：%s\n" "$APP_URL"
node "$PROJECT_DIR/server.mjs"
