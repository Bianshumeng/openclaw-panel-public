# 5.3 运行态证据：Skills 配置写回与校验回滚

时间：2026-02-16

## 1) API 写回链路验证（真实容器）

目标接口：`PUT /api/skills/:skillKey/config`
验证对象：`healthcheck`

执行步骤：
1. 写入补丁：`enabled=true` + `env.PANEL_WRITEBACK_SMOKE=1`
2. 清理补丁：`env.PANEL_WRITEBACK_SMOKE=""`（删除该键）
3. 读取最终配置确认回收

结果（节选）：

```json
{
  "set": {
    "ok": true,
    "result": {
      "skillKey": "healthcheck",
      "config": {
        "enabled": true,
        "hasApiKey": false,
        "env": {
          "PANEL_WRITEBACK_SMOKE": "*"
        }
      }
    }
  },
  "clear": {
    "ok": true,
    "result": {
      "skillKey": "healthcheck",
      "config": {
        "enabled": true,
        "hasApiKey": false,
        "env": {}
      }
    }
  },
  "final": {
    "ok": true,
    "result": {
      "skillKey": "healthcheck",
      "enabled": true,
      "hasApiKey": false,
      "env": {}
    }
  }
}
```

结论：
- 写入后读取校验成功；
- `KEY=` 删除逻辑生效；
- 最终状态已回收到无临时 env 键。

## 2) 前端页面可见性验证（Chrome DevTools MCP）

目标页面：`http://127.0.0.1:18080/skills`

快照命中：
- `Skill 配置写回` 卡片存在
- 字段存在：`启用状态` / `API Key（留空不改）` / `清除当前 API Key` / `环境变量补丁`
- 操作按钮存在：`保存 Skill 配置`

结论：
- Skills 页已具备可视化写回入口，不再只能“查看配置”。

## 3) 自动化验证

命令：

```powershell
node --check public/app.js
node --check src/server.js
npm run test:unit
npm run test:regression
```

结果：
- `node --check` 全部通过
- `test:unit`：51/51 通过（新增 `prepareSkillConfigUpdate` 覆盖）
- `test:regression`：3 通过，1 跳过

## 4) Docker 验证

命令：

```powershell
docker compose up -d --build panel
```

结果：
- `openclaw-panel:local` 构建成功
- `openclaw-panel` 容器重建并启动成功
