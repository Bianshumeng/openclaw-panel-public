#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
export COMPOSE_PROJECT_NAME="openclawpanel"

pull_with_retry() {
  local image="$1"
  local max_attempts="${2:-5}"
  local sleep_base="${RETRY_SLEEP_SECONDS:-3}"
  local attempt

  for ((attempt=1; attempt<=max_attempts; attempt++)); do
    echo "拉取镜像 ${image}（第 ${attempt}/${max_attempts} 次）..."
    if docker pull "$image"; then
      return 0
    fi
    if (( attempt < max_attempts )); then
      sleep $((attempt * sleep_base))
    fi
  done

  return 1
}

set_env_image() {
  local image="$1"
  if grep -q '^OPENCLAW_IMAGE=' ./.env; then
    sed -i "s|^OPENCLAW_IMAGE=.*$|OPENCLAW_IMAGE=${image}|g" ./.env
  else
    echo "OPENCLAW_IMAGE=${image}" >> ./.env
  fi
}

extract_image_repo() {
  local image_ref="$1"
  local without_digest="${image_ref%@*}"
  local last_segment="${without_digest##*/}"

  # Only remove tag if ':' appears in the last path segment.
  if [[ "$last_segment" == *:* ]]; then
    printf '%s\n' "${without_digest%:*}"
    return
  fi

  printf '%s\n' "$without_digest"
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
old_image="$(grep -E '^OPENCLAW_IMAGE=' ./.env | head -n1 | cut -d'=' -f2- || true)"
if [[ -z "$old_image" ]]; then
  old_image="ghcr.io/openclaw/openclaw:2026.2.14"
fi
image_repo="$(extract_image_repo "$old_image")"
if [[ -z "$image_repo" ]]; then
  image_repo="ghcr.io/openclaw/openclaw"
fi
image="${image_repo}:${tag}"
backup_env="./.env.bak.$(date +%Y%m%d%H%M%S)"
cp ./.env "$backup_env"

echo "准备回滚:"
echo "  old: ${old_image}"
echo "  new: ${image}"
if ! pull_with_retry "$image" 5; then
  echo "回滚镜像拉取失败，请稍后重试。"
  exit 1
fi

set_env_image "$image"
if ! docker compose up -d openclaw-gateway; then
  echo "回滚启动失败，恢复旧镜像。"
  set_env_image "$old_image"
  pull_with_retry "$old_image" 3 || true
  docker compose up -d openclaw-gateway || true
  exit 1
fi

sleep 4
running="$(docker inspect --format '{{.State.Running}}' openclaw-gateway 2>/dev/null || true)"
if [[ "$running" != "true" ]]; then
  echo "回滚后容器未运行，恢复旧镜像。"
  set_env_image "$old_image"
  pull_with_retry "$old_image" 3 || true
  docker compose up -d openclaw-gateway || true
  exit 1
fi

docker inspect --format '{{.Name}} {{.State.Status}}' openclaw-gateway
echo "回滚成功: ${image}"
echo "环境备份: ${backup_env}"
