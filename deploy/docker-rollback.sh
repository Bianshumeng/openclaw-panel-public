#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
export COMPOSE_PROJECT_NAME="openclawpanel"

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

if [[ $# -lt 1 ]]; then
  echo "用法: bash deploy/docker-rollback.sh <tag>"
  echo "示例: bash deploy/docker-rollback.sh v2026.2.14"
  exit 1
fi

if [[ ! -f ./.env ]]; then
  echo ".env 不存在，请先执行 bash deploy/docker-init.sh"
  exit 1
fi

tag="$1"
tag="${tag#v}"
image="ghcr.io/openclaw/openclaw:${tag}"

if grep -q '^OPENCLAW_IMAGE=' ./.env; then
  sed -i "s|^OPENCLAW_IMAGE=.*$|OPENCLAW_IMAGE=${image}|g" ./.env
else
  echo "OPENCLAW_IMAGE=${image}" >> ./.env
fi

echo "回滚到: ${image}"
if ! pull_with_retry openclaw-gateway 5; then
  echo "回滚镜像拉取失败，请稍后重试。"
  exit 1
fi
docker compose up -d openclaw-gateway

sleep 4
docker inspect --format '{{.Name}} {{.State.Status}}' openclaw-gateway
