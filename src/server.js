import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { loadPanelConfig, savePanelConfig, defaults } from "./panel-config.js";
import {
  applySettings,
  extractSettings,
  loadOpenClawConfig,
  openClawSettingsSchema,
  saveOpenClawConfig
} from "./openclaw-config.js";
import { runServiceAction } from "./systemd.js";
import { createLogStream, getErrorSummary, getTailLogs } from "./logs.js";
import { testDiscordBot, testFeishuBot, testSlackBot, testTelegramBot } from "./channel-tests.js";
import { toPositiveInt } from "./utils.js";
import { checkForUpdates, rollbackToTag, upgradeToTag } from "./docker-update.js";
import { buildDashboardSummary } from "./dashboard-service.js";
import { getSkillConfig, listSkillsStatus, setSkillEnabled } from "./skills-service.js";
import {
  abortChatRun,
  createChatEventSubscription,
  getChatHistory,
  listChatSessions,
  resetChatSession,
  sendChatMessage
} from "./chat-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({
  logger: false
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "public"),
  prefix: "/"
});

const actionSchema = z.enum(["start", "stop", "restart", "status"]);
const tagPayloadSchema = z.object({
  tag: z.string().min(1, "tag 不能为空")
});
const skillEnabledPayloadSchema = z.object({
  enabled: z.boolean()
});
const chatHistoryQuerySchema = z.object({
  sessionKey: z.string().min(1, "sessionKey 不能为空"),
  limit: z.coerce.number().int().positive().max(1000).optional()
});
const chatStreamQuerySchema = z.object({
  sessionKey: z.string().min(1, "sessionKey 不能为空"),
  includeAgent: z.coerce.boolean().optional().default(true)
});
const chatSendPayloadSchema = z.object({
  sessionKey: z.string().min(1, "sessionKey 不能为空"),
  message: z.string().optional().default(""),
  thinking: z.string().optional().default(""),
  attachments: z.array(z.any()).optional().default([]),
  idempotencyKey: z.string().optional().default(""),
  timeoutMs: z.number().int().positive().max(120000).optional()
});
const chatAbortPayloadSchema = z.object({
  sessionKey: z.string().min(1, "sessionKey 不能为空"),
  runId: z.string().optional().default("")
});
const chatSessionResetPayloadSchema = z.object({
  sessionKey: z.string().min(1, "sessionKey 不能为空"),
  reason: z.enum(["new", "reset"]).optional().default("new")
});

function ensureDockerMode(panelConfig) {
  if ((panelConfig?.runtime?.mode || "systemd") !== "docker") {
    throw new Error("当前不是 Docker 运行模式，不能执行镜像升级/回滚。");
  }
}

function normalizeBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.replace(/\/+$/, "");
}

function buildPublicUrl({ scheme, host, port }) {
  const finalHost = String(host || "").trim();
  const parsedPort = Number(port);
  if (!finalHost || !Number.isFinite(parsedPort) || parsedPort <= 0) {
    return "";
  }
  const finalScheme = String(scheme || "http").trim().toLowerCase() === "https" ? "https" : "http";
  return `${finalScheme}://${finalHost}:${Math.floor(parsedPort)}`;
}

function buildDeploymentMeta(panelConfig) {
  const reverseProxy = panelConfig?.reverse_proxy || {};
  const panelListenHost = String(panelConfig?.panel?.listen_host || "127.0.0.1").trim();
  const panelLocalHost = panelListenHost === "0.0.0.0" ? "127.0.0.1" : panelListenHost;
  const panelListenPort = Number(panelConfig?.panel?.listen_port || 0);
  const panelLocalUrl =
    Number.isFinite(panelListenPort) && panelListenPort > 0 ? `http://${panelLocalHost}:${Math.floor(panelListenPort)}` : "";
  const panelPublicUrl =
    normalizeBaseUrl(reverseProxy.panel_public_base_url) ||
    buildPublicUrl({
      scheme: reverseProxy.public_scheme,
      host: reverseProxy.public_host,
      port: reverseProxy.panel_public_port
    });
  const gatewayPublicUrl = buildPublicUrl({
    scheme: reverseProxy.public_scheme,
    host: reverseProxy.public_host,
    port: reverseProxy.gateway_public_port
  });
  const webhookBaseUrl = normalizeBaseUrl(reverseProxy.webhook_public_base_url) || gatewayPublicUrl;

  return {
    panelLocalUrl,
    panelPublicUrl,
    gatewayPublicUrl,
    webhookBaseUrl,
    hasPublicEndpoint: Boolean(panelPublicUrl),
    hasWebhookEndpoint: Boolean(webhookBaseUrl)
  };
}

app.get("/api/health", async () => {
  return {
    ok: true,
    service: "openclaw-panel",
    timestamp: new Date().toISOString()
  };
});

app.get("/api/panel-config", async () => {
  const { config, filePath } = await loadPanelConfig();
  return {
    ok: true,
    filePath,
    config,
    deployment: buildDeploymentMeta(config)
  };
});

app.put("/api/panel-config", async (request, reply) => {
  try {
    const payload = request.body || {};
    const merged = {
      ...defaults,
      ...payload,
      panel: { ...defaults.panel, ...(payload.panel || {}) },
      runtime: { ...defaults.runtime, ...(payload.runtime || {}) },
      reverse_proxy: { ...defaults.reverse_proxy, ...(payload.reverse_proxy || {}) },
      openclaw: { ...defaults.openclaw, ...(payload.openclaw || {}) },
      docker: { ...defaults.docker, ...(payload.docker || {}) },
      log: { ...defaults.log, ...(payload.log || {}) }
    };
    const saved = await savePanelConfig(merged);
    return {
      ok: true,
      filePath: saved.filePath,
      config: saved.config
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.get("/api/settings", async () => {
  const { config: panelConfig } = await loadPanelConfig();
  const openclawConfig = await loadOpenClawConfig(panelConfig.openclaw.config_path);
  return {
    ok: true,
    panelConfig,
    settings: extractSettings(openclawConfig)
  };
});

app.get("/api/dashboard/summary", async (request, reply) => {
  try {
    const { config: panelConfig } = await loadPanelConfig();
    const openclawConfig = await loadOpenClawConfig(panelConfig.openclaw.config_path);
    const summary = await buildDashboardSummary({
      panelConfig,
      openclawConfig
    });
    return {
      ok: true,
      summary
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.put("/api/settings", async (request, reply) => {
  try {
    const { config: panelConfig } = await loadPanelConfig();
    const payload = openClawSettingsSchema.parse(request.body || {});
    const current = await loadOpenClawConfig(panelConfig.openclaw.config_path);
    const next = applySettings(current, payload);
    const saved = await saveOpenClawConfig(panelConfig.openclaw.config_path, next);
    return {
      ok: true,
      message: "配置写入成功",
      path: saved.path,
      backupPath: saved.backupPath
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.get("/api/skills/status", async (request, reply) => {
  try {
    const { config: panelConfig } = await loadPanelConfig();
    const result = await listSkillsStatus({ panelConfig });
    return {
      ok: true,
      result
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.get("/api/skills/:skillKey/config", async (request, reply) => {
  try {
    const skillKey = String(request.params?.skillKey || "").trim();
    const { config: panelConfig } = await loadPanelConfig();
    const result = await getSkillConfig({ panelConfig, skillKey });
    return {
      ok: true,
      result
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.post("/api/skills/:skillKey/enabled", async (request, reply) => {
  try {
    const skillKey = String(request.params?.skillKey || "").trim();
    const payload = skillEnabledPayloadSchema.parse(request.body || {});
    const { config: panelConfig } = await loadPanelConfig();
    const result = await setSkillEnabled({
      panelConfig,
      skillKey,
      enabled: payload.enabled
    });
    return {
      ok: true,
      result
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.get("/api/chat/sessions", async (request, reply) => {
  try {
    const { config: panelConfig } = await loadPanelConfig();
    const result = await listChatSessions({ panelConfig });
    return {
      ok: true,
      result
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.get("/api/chat/history", async (request, reply) => {
  try {
    const query = chatHistoryQuerySchema.parse(request.query || {});
    const { config: panelConfig } = await loadPanelConfig();
    const result = await getChatHistory({
      panelConfig,
      sessionKey: query.sessionKey,
      limit: query.limit
    });
    return {
      ok: true,
      result
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.post("/api/chat/send", async (request, reply) => {
  try {
    const payload = chatSendPayloadSchema.parse(request.body || {});
    const { config: panelConfig } = await loadPanelConfig();
    const result = await sendChatMessage({
      panelConfig,
      sessionKey: payload.sessionKey,
      message: payload.message,
      thinking: payload.thinking,
      attachments: payload.attachments,
      idempotencyKey: payload.idempotencyKey,
      timeoutMs: payload.timeoutMs
    });
    return {
      ok: true,
      result
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.post("/api/chat/abort", async (request, reply) => {
  try {
    const payload = chatAbortPayloadSchema.parse(request.body || {});
    const { config: panelConfig } = await loadPanelConfig();
    const result = await abortChatRun({
      panelConfig,
      sessionKey: payload.sessionKey,
      runId: payload.runId
    });
    return {
      ok: true,
      result
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.post("/api/chat/session/reset", async (request, reply) => {
  try {
    const payload = chatSessionResetPayloadSchema.parse(request.body || {});
    const { config: panelConfig } = await loadPanelConfig();
    const result = await resetChatSession({
      panelConfig,
      sessionKey: payload.sessionKey,
      reason: payload.reason
    });
    return {
      ok: true,
      result
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.get("/api/chat/stream", async (request, reply) => {
  let query;
  try {
    query = chatStreamQuerySchema.parse(request.query || {});
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }

  const { config: panelConfig } = await loadPanelConfig();
  const sessionKey = String(query.sessionKey || "").trim();
  const includeAgent = query.includeAgent !== false;
  let stopped = false;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let currentSubscription = null;
  let reconnectAttempt = 0;

  const send = (event, payload) => {
    if (stopped) {
      return;
    }
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const stopCurrentSubscription = () => {
    if (!currentSubscription) {
      return;
    }
    try {
      currentSubscription.close();
    } catch {
      // ignore close failure
    }
    currentSubscription = null;
  };

  const scheduleReconnect = (reason = "") => {
    if (stopped) {
      return;
    }
    reconnectAttempt += 1;
    const delayMs = Math.min(10_000, Math.max(1_000, reconnectAttempt * 1_000));
    send("status", {
      state: "reconnecting",
      sessionKey,
      attempt: reconnectAttempt,
      delayMs,
      reason: String(reason || "").trim() || "gateway disconnected"
    });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectGateway();
    }, delayMs);
  };

  const connectGateway = () => {
    if (stopped) {
      return;
    }
    stopCurrentSubscription();

    currentSubscription = createChatEventSubscription({
      panelConfig,
      sessionKey,
      includeAgent,
      onEvent: (eventPayload) => {
        send(eventPayload.type || "message", eventPayload);
      },
      onError: (error) => {
        send("stream-error", {
          sessionKey,
          message: error?.message || String(error)
        });
      },
      onClose: ({ code, reason }) => {
        if (stopped) {
          return;
        }
        send("status", {
          state: "gateway-closed",
          sessionKey,
          code,
          reason: String(reason || "")
        });
        scheduleReconnect(reason);
      }
    });

    currentSubscription.ready
      .then(() => {
        if (stopped) {
          return;
        }
        reconnectAttempt = 0;
        send("status", {
          state: "connected",
          sessionKey,
          includeAgent,
          at: new Date().toISOString()
        });
      })
      .catch((error) => {
        if (stopped) {
          return;
        }
        send("status", {
          state: "connect-failed",
          sessionKey,
          message: error?.message || String(error)
        });
        scheduleReconnect(error?.message || String(error));
      });
  };

  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });

  send("ready", {
    sessionKey,
    includeAgent,
    at: new Date().toISOString()
  });

  heartbeatTimer = setInterval(() => {
    send("heartbeat", {
      sessionKey,
      ts: Date.now()
    });
  }, 15_000);

  connectGateway();

  request.raw.on("close", () => {
    stopped = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopCurrentSubscription();
  });
});

app.post("/api/service/:action", async (request, reply) => {
  try {
    const action = actionSchema.parse(request.params.action);
    const { config: panelConfig } = await loadPanelConfig();
    const result = await runServiceAction(action, panelConfig);
    return {
      ok: result.ok,
      result
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.get("/api/logs/tail", async (request, reply) => {
  try {
    const lines = toPositiveInt(request.query?.lines, 200);
    const filter = String(request.query?.filter || "");
    const { config: panelConfig } = await loadPanelConfig();
    const data = await getTailLogs({ panelConfig, lines, filter });
    return {
      ok: true,
      lines: data
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.get("/api/logs/errors", async (request, reply) => {
  try {
    const count = toPositiveInt(request.query?.count, 20);
    const { config: panelConfig } = await loadPanelConfig();
    const lines = await getErrorSummary({ panelConfig, count });
    return {
      ok: true,
      lines
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.get("/api/logs/stream", async (request, reply) => {
  const filter = String(request.query?.filter || "").toLowerCase();
  const { config: panelConfig } = await loadPanelConfig();

  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });

  const send = (event, payload) => {
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const pass = (line) => !filter || line.toLowerCase().includes(filter);
  const stop = createLogStream({
    panelConfig,
    onLine: (line) => {
      if (pass(line)) {
        send("line", { line });
      }
    },
    onError: (line) => {
      send("error", { line });
    }
  });

  const heartbeat = setInterval(() => {
    send("heartbeat", { ts: Date.now() });
  }, 15000);

  request.raw.on("close", () => {
    clearInterval(heartbeat);
    stop();
  });
});

app.post("/api/test/telegram", async (request, reply) => {
  const payload = request.body || {};
  const result = await testTelegramBot(payload.botToken || "");
  return {
    ok: result.ok,
    message: result.message
  };
});

app.post("/api/test/feishu", async (request) => {
  const payload = request.body || {};
  const result = await testFeishuBot(payload.appId || "", payload.appSecret || "");
  return {
    ok: result.ok,
    message: result.message
  };
});

app.post("/api/test/discord", async (request) => {
  const payload = request.body || {};
  const result = await testDiscordBot(payload.token || "");
  return {
    ok: result.ok,
    message: result.message
  };
});

app.post("/api/test/slack", async (request) => {
  const payload = request.body || {};
  const result = await testSlackBot({
    mode: payload.mode || "socket",
    botToken: payload.botToken || "",
    appToken: payload.appToken || "",
    signingSecret: payload.signingSecret || ""
  });
  return {
    ok: result.ok,
    message: result.message
  };
});

app.get("/api/update/check", async (request, reply) => {
  try {
    const { config: panelConfig } = await loadPanelConfig();
    ensureDockerMode(panelConfig);
    const containerName = panelConfig?.openclaw?.container_name || panelConfig?.openclaw?.service_name || "openclaw-gateway";
    const imageRepo = panelConfig?.openclaw?.image_repo || "ghcr.io/openclaw/openclaw";
    const result = await checkForUpdates({ containerName, imageRepo });
    return {
      ok: true,
      result
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.post("/api/update/upgrade", async (request, reply) => {
  try {
    const payload = tagPayloadSchema.parse(request.body || {});
    const { config: panelConfig } = await loadPanelConfig();
    ensureDockerMode(panelConfig);
    const containerName = panelConfig?.openclaw?.container_name || panelConfig?.openclaw?.service_name || "openclaw-gateway";
    const imageRepo = panelConfig?.openclaw?.image_repo || "ghcr.io/openclaw/openclaw";
    const result = await upgradeToTag({
      containerName,
      targetTag: payload.tag,
      imageRepo
    });
    return {
      ok: result.ok,
      result
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.post("/api/update/rollback", async (request, reply) => {
  try {
    const payload = tagPayloadSchema.parse(request.body || {});
    const { config: panelConfig } = await loadPanelConfig();
    ensureDockerMode(panelConfig);
    const containerName = panelConfig?.openclaw?.container_name || panelConfig?.openclaw?.service_name || "openclaw-gateway";
    const imageRepo = panelConfig?.openclaw?.image_repo || "ghcr.io/openclaw/openclaw";
    const result = await rollbackToTag({
      containerName,
      targetTag: payload.tag,
      imageRepo
    });
    return {
      ok: result.ok,
      result
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.setNotFoundHandler(async (request, reply) => {
  if (request.raw.url?.startsWith("/api/")) {
    reply.code(404);
    return {
      ok: false,
      message: "API not found"
    };
  }
  return reply.sendFile("index.html");
});

async function main() {
  const { config } = await loadPanelConfig();
  const host = config.panel.listen_host;
  const port = config.panel.listen_port;

  await app.listen({ host, port });
  console.log(`OpenClaw panel listening on http://${host}:${port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
