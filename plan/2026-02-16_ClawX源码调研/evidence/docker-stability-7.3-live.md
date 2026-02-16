# 7.3 运行态证据：Docker 场景稳定性验证

时间：2026-02-16

## 验证目标

- 重启 `panel` 容器后，配置不漂移；
- 核心功能接口（Dashboard/Chat/Logs）可恢复；
- 健康检查在可接受时间内恢复。

## 执行步骤

1. 重启前采集基线：
   - `GET /api/settings`（模型与渠道开关）
   - `GET /api/skills/status`（skills 总数）
2. 执行 `docker compose restart panel`
3. 轮询 `GET /api/health` 直到恢复
4. 重启后再次采集基线并比对
5. 执行关键 smoke：
   - `GET /api/dashboard/summary`
   - `GET /api/chat/sessions`
   - `GET /api/logs/tail?lines=5`

## 结果（节选）

```json
{
  "healthRecovered": true,
  "configConsistent": true,
  "before": {
    "modelPrimary": "anthropic/default-model",
    "modelProvider": "anthropic",
    "modelId": "claude-sonnet-4-5-20250929",
    "skillsTotal": 49,
    "channels": {
      "telegram": false,
      "feishu": false,
      "discord": false,
      "slack": false
    }
  },
  "after": {
    "modelPrimary": "anthropic/default-model",
    "modelProvider": "anthropic",
    "modelId": "claude-sonnet-4-5-20250929",
    "skillsTotal": 49,
    "channels": {
      "telegram": false,
      "feishu": false,
      "discord": false,
      "slack": false
    }
  },
  "smoke": {
    "dashboardOk": true,
    "chatSessions": 21,
    "logTailLines": 5
  }
}
```

## 结论

- 容器重启后服务可恢复；
- 配置数据保持一致；
- 关键功能链路未受重启影响。
