# 5.1 运行态证据：Skills 列表与状态展示

时间：2026-02-16

## 1) 运行态页面校验（Chrome DevTools MCP）

目标页面：`http://127.0.0.1:18080/skills`

快照关键项：

- 页面说明文案包含：`查看技能状态、说明、最近更新时间`
- Skill 列表项包含：
  - `key: ... | source: ... | bundled: ... | 最近更新: ...`
  - `说明：...`

示例（快照摘录）：

- `key: feishu-doc | source: openclaw-extra | bundled: 否 | 最近更新: 无`
- `说明：Feishu document read/write operations...`

结论：
- Skills 列表已覆盖“名称/启用状态/说明/最近更新时间”四类核心信息。
- 对无更新时间的技能，页面显示 `最近更新: 无`，避免空值歧义。

## 2) 自动化验证

命令：

```powershell
node --check public/app.js
npm run test:unit
npm run test:regression
```

结果：
- `node --check` 通过
- `test:unit`：48/48 通过（含 skills-service 归一化断言）
- `test:regression`：3 通过，1 跳过

## 3) Docker 验证

命令：

```powershell
docker compose up -d --build panel
```

结果：
- `openclaw-panel:local` 构建成功
- `openclaw-panel` 重建并启动成功
