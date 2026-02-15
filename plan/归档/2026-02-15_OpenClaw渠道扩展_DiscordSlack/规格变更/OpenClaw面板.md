# OpenClaw面板 - 变更

## 修改需求
### 需求：可视化配置中心
在现有 Telegram / 飞书基础上，新增 Discord / Slack 可视化配置能力，并保持字段映射到官方配置结构。

#### 场景：Discord 字段可视化
- 当 用户在页面修改 Discord 开关、Token、DM 策略、群策略等字段
- 那么 系统必须映射写入 `channels.discord.*`，并兼容 `channels.discord.dm.*`

#### 场景：Slack 字段可视化
- 当 用户在页面修改 Slack 模式、Token、Signing Secret、DM 策略等字段
- 那么 系统必须映射写入 `channels.slack.*`，并兼容 `channels.slack.dm.*`

#### 场景：策略校验
- 当 用户将 Discord/Slack 的 DM 策略设置为 `open`
- 那么 系统必须要求 `allowFrom` 包含 `*`，否则拒绝写入
