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

cleanup_conflict_container() {
  local name="$1"
  local existing_project

  if ! docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    return 0
  fi

  existing_project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$name" 2>/dev/null || true)"
  if [[ -z "$existing_project" || "$existing_project" == "$COMPOSE_PROJECT_NAME" ]]; then
    return 0
  fi

  echo "检测到旧容器 ${name}（compose 项目: ${existing_project}），为避免命名冲突将自动移除。"
  docker rm -f "$name" >/dev/null
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

cleanup_conflict_container openclaw-gateway
cleanup_conflict_container openclaw-panel

echo "构建面板镜像..."
docker compose build panel

echo "启动服务..."
docker compose up -d

panel_bind_ip="$(grep -E '^PANEL_BIND_IP=' ./.env | head -n1 | cut -d'=' -f2- || true)"
panel_port="$(grep -E '^PANEL_PORT=' ./.env | head -n1 | cut -d'=' -f2- || true)"
gateway_bind_ip="$(grep -E '^OPENCLAW_GATEWAY_BIND_IP=' ./.env | head -n1 | cut -d'=' -f2- || true)"
gateway_port="$(grep -E '^OPENCLAW_GATEWAY_PORT=' ./.env | head -n1 | cut -d'=' -f2- || true)"
panel_bind_ip="${panel_bind_ip:-127.0.0.1}"
panel_port="${panel_port:-18080}"
gateway_bind_ip="${gateway_bind_ip:-0.0.0.0}"
gateway_port="${gateway_port:-18789}"

panel_hint_host="$panel_bind_ip"
if [[ "$panel_hint_host" == "0.0.0.0" ]]; then
  panel_hint_host="127.0.0.1"
fi

echo ""
echo "启动完成："
echo "  面板(映射地址): http://${panel_hint_host}:${panel_port}"
echo "  网关(映射地址): http://${gateway_bind_ip}:${gateway_port}"
echo "  如需展示公网地址/Webhook地址，请编辑 data/panel/panel.config.json 的 reverse_proxy 字段。"
echo "  查看容器: docker compose ps"
echo "  查看网关日志: docker logs -f openclaw-gateway"
