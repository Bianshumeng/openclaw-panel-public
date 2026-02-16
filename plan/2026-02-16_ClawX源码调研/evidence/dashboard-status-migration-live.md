# 状态总览迁移到仪表盘运行态证据

时间：2026-02-16 17:08

## 验证目标

1. 侧栏不再显示“状态总览”独立入口；
2. 状态总览信息已收敛在“仪表盘”；
3. 历史路径 `/status-overview` 仍可访问并落到仪表盘视图；
4. 路由兼容行为有自动化验证覆盖。

## 执行记录

1. 自动化测试
```bash
npm run test:unit
npm run test:regression
```
结果：
- `test:unit` 48/48 通过（包含 `app-routes` 别名断言）
- `test:regression` 3 passed, 1 skipped

2. Docker 重建
```bash
docker compose up -d --build panel
```
结果：`openclaw-panel` 成功重建并启动。

3. 侧栏入口校验（静态）
```powershell
$html=(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18080/dashboard).Content
$html.Contains('data-tab-target="panel-status-overview"')
```
结果：`False`（侧栏已无独立入口）。

4. 路由兼容映射校验（静态）
```powershell
$routes=(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18080/app-routes.js).Content
```
检查项结果：
- 含 `if (path === "/status-overview") return "panel-dashboard"` -> OK
- 含 `isKnownPanelPath` 对 `/status-overview` 兼容 -> OK

5. 运行态页面校验（浏览器快照）
- 使用 Chrome DevTools MCP 打开 `http://127.0.0.1:18080/status-overview`。
- 快照结果显示：
  - 侧栏入口列表不含“状态总览”；
  - 主区域展示“仪表盘”内容（系统状态、状态总览卡片、快捷操作、运行态明细）。

## 结论

“系统状态模块从侧栏迁移到仪表盘”已完成，且旧链接仍兼容可用。
