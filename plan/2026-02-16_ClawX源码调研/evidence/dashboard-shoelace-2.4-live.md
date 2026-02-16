# Dashboard Shoelace 2.4 验证证据

## 1) 自动化测试
```bash
npm test
```
结果：通过（unit + regression）。

## 2) Docker 重建
```bash
docker compose up -d --build panel
```
结果：`openclaw-panel` 重新构建并启动成功。

## 3) 运行态可用性
```bash
GET http://127.0.0.1:18080/api/health
```
返回：`{"ok":true,...}`。

```bash
GET http://127.0.0.1:18080/shoelace/themes/light.css
```
返回：`200`。

## 4) 页面抽样检查
- 页面：`http://127.0.0.1:18080/dashboard`
- 观察项：
  - 仪表盘 KPI 卡片渲染正常
  - 运行态明细卡片渲染正常
  - 快捷操作按钮可点击
  - 模型快速切换下拉与按钮可交互
