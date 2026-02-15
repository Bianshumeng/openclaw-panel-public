# OpenClaw Panel

面向 Debian 13 模板小鸡的 OpenClaw 可视化管理面板。

## 已实现能力
- 字段化配置：模型/API、Telegram、飞书、Discord、Slack
- 配置校验：必填、URL、策略校验（如 `open` 模式必须含 `*`）
- 服务控制：支持 `systemd` 和 `docker` 两种运行时
- 日志面板：最近日志、实时流、错误摘要（支持 `journal`/`file`/`docker`）
- 渠道测试：Telegram/飞书/Discord/Slack 连通性
- 版本管理：检查最新版本、一键升级、手动回滚（升级失败自动回滚）
- 独立路由页面：`/model`、`/channels`、`/update`、`/service`、`/logs`

## Docker（推荐）
> 当前生产建议使用受控镜像 tag：`ghcr.io/openclaw/openclaw:2026.2.14`
> 注意：上游镜像 tag 不带 `v` 前缀。

### 一键初始化
```bash
bash deploy/docker-init.sh
```

脚本会自动：
- 生成 `.env`（含随机 `OPENCLAW_GATEWAY_TOKEN`）
- 初始化 `data/openclaw/openclaw.json`
- 初始化 `data/panel/panel.config.json`（runtime=docker）
- `docker compose pull/build/up -d`

### 目录说明
- `docker-compose.yml`: 双容器编排（`openclaw-gateway` + `openclaw-panel`）
- `data/openclaw`: OpenClaw 配置与工作区持久化
- `data/panel`: 面板运行配置持久化

### 升级与回滚
```bash
# 升级到指定版本（支持传 v 前缀）
bash deploy/docker-update.sh v2026.2.14

# 手动回滚到指定版本
bash deploy/docker-rollback.sh v2026.2.14
```

说明：
- `docker-update.sh` 会在拉镜像、重建容器、启动探活失败时自动回滚到旧版本。
- `docker-init.sh` / `docker-update.sh` / `docker-rollback.sh` 内置镜像拉取重试，降低 GHCR 网络抖动导致的失败概率。
- 三个脚本会强制使用 `COMPOSE_PROJECT_NAME=openclawpanel`，避免外部环境变量导致 compose 项目名漂移。

## 本地 Node 模式（兼容）
```bash
npm install
npm start
```

默认配置文件：`~/.openclaw-panel/panel.config.json`  
默认监听：`127.0.0.1:18080`

## 运行检查
```bash
npm run check
```

## 测试
```bash
# 单元 + 回归
npm run test

# 仅单元
npm run test:unit

# 仅回归
npm run test:regression
```

## CI/CD
- `CI`：`.github/workflows/ci.yml`
  - 触发：`push` / `pull_request`
  - 执行：`npm ci`、`npm run test`、`npm run check`
- `CD`：`.github/workflows/cd-panel-image.yml`
  - 触发：手动 `workflow_dispatch` 或 Git Tag `panel-v*`
  - 产物：`ghcr.io/<你的组织或用户名>/openclaw-panel:<version>` 与 `:latest`

## 安全建议
- 面板仅监听内网/回环，外网访问必须走反代并加鉴权。
- Docker 模式下，面板需要访问 Docker Socket（`/var/run/docker.sock`），务必限制面板暴露面。
