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

function ensureDockerMode(panelConfig) {
  if ((panelConfig?.runtime?.mode || "systemd") !== "docker") {
    throw new Error("当前不是 Docker 运行模式，不能执行镜像升级/回滚。");
  }
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
    config
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
    const result = await checkForUpdates({ containerName });
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
