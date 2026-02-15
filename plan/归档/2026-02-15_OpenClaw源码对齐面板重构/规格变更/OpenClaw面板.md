# OpenClaw面板 - 变更

## 修改需求
### 需求：可视化配置中心
将首批字段从“通用占位字段”升级为 “OpenClaw 官方结构字段”。

#### 场景：模型字段对齐
- 当 用户配置 AI 模型
- 那么 系统必须映射到 `models.providers.*` 与 `agents.defaults.model.primary`

#### 场景：渠道字段对齐
- 当 用户配置 Telegram / Feishu
- 那么 系统必须映射到 `channels.telegram.*` 与 `channels.feishu.*`

### 需求：安全基线
用户页面不展示小鸡监听地址、端口、网关端点等运维字段。

#### 场景：用户操作页面
- 当 用户进入配置页面
- 那么 页面只展示模型与渠道业务字段，不展示基础设施端点

