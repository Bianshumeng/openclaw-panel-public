#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
export COMPOSE_PROJECT_NAME="openclawpanel"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少依赖: $1"
    exit 1
  fi
}

require_cmd docker
docker compose version >/dev/null 2>&1 || {
  echo "docker compose 不可用"
  exit 1
}

pull_with_retry() {
  local service="$1"
  local max_attempts="${2:-5}"
  local attempt

  for ((attempt=1; attempt<=max_attempts; attempt++)); do
    echo "拉取 ${service} 镜像（第 ${attempt}/${max_attempts} 次）..."
    if docker compose pull "$service"; then
      return 0
    fi
    if (( attempt < max_attempts )); then
      sleep $((attempt * 3))
    fi
  done

  return 1
}

mkdir -p ./data/openclaw ./data/openclaw/workspace ./data/panel

if [[ ! -f ./.env ]]; then
  cp ./.env.example ./.env
  if command -v openssl >/dev/null 2>&1; then
    token="$(openssl rand -hex 32)"
  else
    token="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
  fi
  sed -i "s/replace-with-random-token/${token}/g" ./.env
  echo ".env 已创建，并生成随机 OPENCLAW_GATEWAY_TOKEN"
fi

if [[ ! -f ./data/panel/panel.config.json ]]; then
  cp ./deploy/panel.config.docker.json ./data/panel/panel.config.json
  chmod 600 ./data/panel/panel.config.json || true
  echo "已写入 ./data/panel/panel.config.json"
fi

if [[ ! -f ./data/openclaw/openclaw.json ]]; then
  cat > ./data/openclaw/openclaw.json <<'EOF'
{
  "gateway": {
    "mode": "local"
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/gpt-4o-mini"
      }
    }
  },
  "models": {
    "providers": {
      "openai": {
        "api": "openai-responses",
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "",
        "models": [
          {
            "id": "gpt-4o-mini",
            "name": "GPT-4o Mini",
            "contextWindow": 128000,
            "maxTokens": 16384
          }
        ]
      }
    }
  },
  "channels": {}
}
EOF
  chmod 600 ./data/openclaw/openclaw.json || true
  echo "已初始化 ./data/openclaw/openclaw.json"
fi

echo "拉取 OpenClaw 镜像..."
if ! pull_with_retry openclaw-gateway 5; then
  echo "拉取镜像失败，请检查网络或稍后重试。"
  exit 1
fi

echo "构建面板镜像..."
docker compose build panel

echo "启动服务..."
docker compose up -d

echo ""
echo "启动完成："
echo "  面板: http://127.0.0.1:18080"
echo "  查看容器: docker compose ps"
echo "  查看网关日志: docker logs -f openclaw-gateway"
