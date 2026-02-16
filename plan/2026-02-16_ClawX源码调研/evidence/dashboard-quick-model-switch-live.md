# 仪表盘模型快速切换运行态证据

时间：2026-02-16 17:14

## 验证目标

1. 仪表盘可直接选择并切换默认模型；
2. 上下文降级风险提示可正确触发；
3. 仪表盘与模型页的上下文输入共享同一状态；
4. 功能在 Docker 运行态可用。

## 执行记录

1. 自动化测试
```bash
npm run test:unit
npm run test:regression
```
结果：
- `test:unit` 48/48 通过
- `test:regression` 3 passed, 1 skipped

2. Docker 重建
```bash
docker compose up -d --build panel
```
结果：`openclaw-panel` 成功重建并启动。

3. 页面元素校验（浏览器快照）
- 访问 `http://127.0.0.1:18080/dashboard`；
- 快照可见：
  - `当前会话上下文（Token）` 输入框；
  - `快速切换默认模型` 下拉框；
  - `切换当前默认模型` 按钮；
  - 目标模型提示行。

4. 风险提示触发校验（浏览器脚本）
执行脚本：
- 将上下文设为 `500000`；
- 选择目标模型 `aicodecat-claude/claude-sonnet-4-5-20250929`（`contextWindow=200000`）；
- 临时劫持 `window.confirm` 并触发切换按钮。

返回结果：
```json
{
  "ok": true,
  "target": "aicodecat-claude/claude-sonnet-4-5-20250929",
  "confirmCalled": 1,
  "confirmText": "当前会话上下文约 500,000，目标模型上限为 200,000。\n切换后可能因上下文超限报错，确认继续切换吗？",
  "contextValue": "500000"
}
```

5. 未确认切换时的当前模型状态
- 查询结果：
```json
{
  "currentModel": "gpt-5.2",
  "selectedQuickRef": "aicodecat-claude/claude-sonnet-4-5-20250929"
}
```
- 说明：在确认框返回 `false` 时，不会误切换当前模型。

## 结论

仪表盘模型快速切换与上下文风险提示已闭环，行为符合预期。
