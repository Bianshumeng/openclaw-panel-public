# OpenClaw面板 - 变更

## 新增需求
### 需求：面板运行时可配置
#### 场景：监听与路径配置
- 当 面板在不同模板机运行
- 那么 系统必须支持 `panel.listen_host`、`panel.listen_port`、`openclaw.config_path`、`openclaw.service_name` 的可配置化

### 需求：日志来源可切换
#### 场景：journal/file 双模式
- 当 用户选择日志来源
- 那么 系统必须支持 `journalctl` 与文件日志两种读取方式

## 修改需求
### 需求：可视化配置中心
面板除字段化编辑外，新增最低校验基线：必填、URL 格式、模型名非空。

## 移除需求
### 需求：无
移除原因：本次无需求移除。
迁移方案：不适用。

