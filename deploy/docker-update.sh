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
  echo "用法: bash deploy/docker-update.sh <tag>"
  echo "示例: bash deploy/docker-update.sh v2026.2.14"
  exit 1
fi

if [[ ! -f ./.env ]]; then
  echo ".env 不存在，请先执行 bash deploy/docker-init.sh"
  exit 1
fi

tag="$1"
tag="${tag#v}"
new_image="ghcr.io/openclaw/openclaw:${tag}"

old_image="$(grep -E '^OPENCLAW_IMAGE=' ./.env | head -n1 | cut -d'=' -f2- || true)"
if [[ -z "$old_image" ]]; then
  old_image="ghcr.io/openclaw/openclaw:2026.2.14"
fi

backup_env="./.env.bak.$(date +%Y%m%d%H%M%S)"
cp ./.env "$backup_env"

if grep -q '^OPENCLAW_IMAGE=' ./.env; then
  sed -i "s|^OPENCLAW_IMAGE=.*$|OPENCLAW_IMAGE=${new_image}|g" ./.env
else
  echo "OPENCLAW_IMAGE=${new_image}" >> ./.env
fi

echo "准备升级:"
echo "  old: ${old_image}"
echo "  new: ${new_image}"

rollback_to_old() {
  echo "恢复到旧镜像: ${old_image}"
  sed -i "s|^OPENCLAW_IMAGE=.*$|OPENCLAW_IMAGE=${old_image}|g" ./.env
  pull_with_retry openclaw-gateway 5 || true
  docker compose up -d openclaw-gateway || true
}

echo "拉取新镜像..."
if ! pull_with_retry openclaw-gateway 5; then
  echo "新镜像拉取失败，自动回退配置。"
  rollback_to_old
  exit 1
fi

echo "重建网关容器..."
if ! docker compose up -d openclaw-gateway; then
  echo "网关重建失败，自动回滚。"
  rollback_to_old
  exit 1
fi

sleep 6
running="$(docker inspect --format '{{.State.Running}}' openclaw-gateway 2>/dev/null || true)"

if [[ "$running" != "true" ]]; then
  echo "升级失败，开始自动回滚到: ${old_image}"
  rollback_to_old
  echo "已回滚。"
  exit 1
fi

echo "升级成功: ${new_image}"
echo "如需回滚，可执行:"
echo "  bash deploy/docker-rollback.sh ${old_image##*:}"
echo "环境备份:"
echo "  ${backup_env}"
