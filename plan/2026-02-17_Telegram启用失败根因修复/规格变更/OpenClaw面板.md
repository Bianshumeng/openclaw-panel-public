# OpenClaw面板 - 变更

## 修改需求

### 需求：可视化配置中心

面板必须支持以字段化方式编辑 OpenClaw 关键配置，至少覆盖 API、Base URL、模型、Telegram、飞书、Discord、Slack 等常用字段。

#### 场景：字段化编辑
- 当 用户进入配置中心并修改关键字段
- 那么 系统必须进行输入校验并写入配置文件

#### 场景：敏感字段保护
- 当 用户查看已保存的 API Key 或 Secret
- 那么 面板必须默认掩码显示，不直接明文回显

#### 场景：字段校验
- 当 用户提交配置
- 那么 系统必须执行必填、URL 格式、模型名非空等基础校验

#### 场景：OpenClaw 官方字段映射
- 当 用户修改模型与渠道配置
- 那么 系统必须映射到官方字段：`models.providers.*`、`agents.defaults.model.primary`、`channels.telegram.*`、`channels.feishu.*`、`channels.discord.*`、`channels.slack.*`

#### 场景：Telegram 快速接入可视输入
- 当 用户在 Telegram 基础配置第 1 步输入 Bot Token
- 那么 输入框应默认明文可见，便于粘贴核对；而已保存密钥的回显仍保持掩码值

### 需求：运行参数可配置

面板必须支持监听地址、端口、OpenClaw 配置路径、服务名、容器名、日志来源、运行时模式等运行参数可配置。

#### 场景：模板适配
- 当 面板部署到不同模板机
- 那么 运维人员必须可通过配置修改运行参数而无需改代码

#### 场景：Docker CLI 入口兼容
- 当 运行时模式为 Docker 且容器中不存在 `openclaw` 可执行入口
- 那么 系统必须自动回退到可用入口（如 `node /app/openclaw.mjs`）继续执行启用/配置命令
