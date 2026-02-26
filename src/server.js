import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { loadPanelConfig, savePanelConfig, defaults } from "./panel-config.js";
import {
  applySettings,
  ensureOpenClawConfigPermissions,
  extractSettings,
  loadOpenClawConfig,
  openClawSettingsSchema,
  removeModelFromCatalog,
  removeProviderFromCatalog,
  saveOpenClawConfig,
  updateModelInCatalog,
  updateProviderInCatalog
} from "./openclaw-config.js";
import { runServiceAction } from "./systemd.js";
import { createLogStream, getErrorSummary, getTailLogs } from "./logs.js";
import { testDiscordBot, testFeishuBot, testSlackBot, testTelegramBot } from "./channel-tests.js";
import { expandHome, toPositiveInt } from "./utils.js";
import {
  applyPanelDirectUpdate,
  checkBotDirectUpdate,
  checkPanelDirectUpdate,
  mutateBotDirectUpdate,
  stagePanelDirectUpdate
} from "./direct-update.js";
import { buildDashboardSummary } from "./dashboard-service.js";
import { getSkillConfig, listSkillsStatus, prepareSkillConfigUpdate, setSkillEnabled } from "./skills-service.js";
import { approvePendingGatewayPairings, approveTelegramPairing, setupTelegramBasic } from "./channel-onboarding.js";
import {
  abortChatRun,
  createChatSession,
  createChatEventSubscription,
  getChatHistory,
  listChatSessions,
  resetChatSession,
  sendChatMessage,
  stageChatAttachment
} from "./chat-service.js";
import { rotateGatewayTokenAndApprovePairings } from "./gateway-token.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({
  logger: false
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "public"),
  prefix: "/"
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "node_modules", "@shoelace-style", "shoelace", "cdn"),
  prefix: "/shoelace/",
  decorateReply: false
});

const actionSchema = z.enum(["start", "stop", "restart", "status"]);
const updateTargetSchema = z.enum(["bot", "panel"]);
const updateCheckQuerySchema = z.object({
  target: updateTargetSchema.optional().default("bot")
});
const tagPayloadSchema = z.object({
  tag: z.string().optional().default(""),
  target: updateTargetSchema.optional().default("bot")
});
const skillEnabledPayloadSchema = z.object({
  enabled: z.boolean()
});
const skillConfigPatchPayloadSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z.string().optional(),
    clearApiKey: z.boolean().optional().default(false),
    env: z.record(z.string()).optional()
  })
  .superRefine((payload, ctx) => {
    const hasEnabled = typeof payload.enabled === "boolean";
    const apiKey = String(payload.apiKey || "").trim();
    const clearApiKey = payload.clearApiKey === true;
    const envPatch = payload.env && typeof payload.env === "object" ? payload.env : {};
    const hasEnv = Object.keys(envPatch).some((key) => String(key || "").trim());
    if (!hasEnabled && !apiKey && !clearApiKey && !hasEnv) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "至少提供一个可写入字段（enabled/apiKey/clearApiKey/env）"
      });
    }
    if (clearApiKey && apiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "clearApiKey=true 时不能同时提供 apiKey"
      });
    }
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
const chatSessionNewPayloadSchema = z.object({
  keyPrefix: z.string().optional().default("")
});
const chatAttachmentStagePayloadSchema = z.object({
  fileName: z.string().min(1, "fileName 不能为空"),
  mimeType: z.string().optional().default("application/octet-stream"),
  base64: z.string().min(1, "base64 不能为空")
});
const telegramSetupPayloadSchema = z.object({
  botToken: z.string().min(1, "Bot Token 不能为空")
});
const telegramPairingPayloadSchema = z.object({
  code: z.string().min(1, "验证码不能为空")
});
const providerPathParamSchema = z.object({
  providerId: z.string().min(1, "providerId 不能为空")
});
const modelPathParamSchema = z.object({
  providerId: z.string().min(1, "providerId 不能为空"),
  modelId: z.string().min(1, "modelId 不能为空")
});
const updateProviderPayloadSchema = z.object({
  nextProviderId: z.string().min(1, "供应商名称不能为空"),
  api: z.string().min(1, "API 模式不能为空"),
  baseUrl: z.string().min(1, "API 地址不能为空"),
  apiKey: z.string().optional()
});
const updateModelPayloadSchema = z.object({
  nextModelId: z.string().min(1, "模型 ID 不能为空"),
  name: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional()
});
const rawOpenClawConfigPayloadSchema = z.object({
  rawText: z.string().min(1, "配置 JSON 不能为空"),
  expectedMtimeMs: z.number().nonnegative().optional()
});

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

function trimText(value) {
  return String(value || "").trim();
}

function runCommand(command, args, timeout = 15000, options = {}) {
  const extraEnv =
    options?.env && typeof options.env === "object" && !Array.isArray(options.env) ? options.env : {};
  const commandEnv = {
    ...process.env,
    ...extraEnv
  };
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 5 * 1024 * 1024, env: commandEnv }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim(),
        message: error?.message || ""
      });
    });
  });
}

function maskToken(value) {
  const token = trimText(value);
  if (!token) {
    return "";
  }
  if (token.length <= 8) {
    return "*".repeat(token.length);
  }
  return `${token.slice(0, 4)}***${token.slice(-4)}`;
}

function readGatewayTokenFromConfig(openclawConfig) {
  return trimText(openclawConfig?.gateway?.auth?.token);
}

function resolveUpdateTarget(panelConfig, target = "bot") {
  const selectedTarget = updateTargetSchema.parse(target);
  if (selectedTarget === "panel") {
    return {
      target: selectedTarget,
      releaseRepo: trimText(panelConfig?.update?.panel_release_repo),
      panelServiceName: trimText(panelConfig?.update?.panel_service_name) || "openclaw-panel",
      panelAppDir: trimText(panelConfig?.update?.panel_app_dir),
      upgradeMode: "staged-apply"
    };
  }

  return {
    target: selectedTarget,
    releaseRepo: trimText(panelConfig?.update?.bot_release_repo),
    upgradeMode: "direct"
  };
}

function normalizeSkillConfigPatch(payload = {}) {
  const patch = {};
  if (typeof payload.enabled === "boolean") {
    patch.enabled = payload.enabled;
  }

  const apiKey = trimText(payload.apiKey);
  if (apiKey) {
    patch.apiKey = apiKey;
  }
  if (payload.clearApiKey === true) {
    patch.clearApiKey = true;
  }

  if (payload.env && typeof payload.env === "object" && !Array.isArray(payload.env)) {
    const envPatch = {};
    for (const [key, value] of Object.entries(payload.env)) {
      const envKey = trimText(key);
      if (!envKey) {
        continue;
      }
      envPatch[envKey] = trimText(value);
    }
    if (Object.keys(envPatch).length > 0) {
      patch.env = envPatch;
    }
  }

  return patch;
}

function validateSkillConfigWriteback({ patch = {}, config = {} }) {
  if (typeof patch.enabled === "boolean" && config.enabled !== patch.enabled) {
    throw new Error("enabled 写回校验失败");
  }
  if (patch.clearApiKey === true && config.hasApiKey) {
    throw new Error("apiKey 清除校验失败");
  }
  if (patch.apiKey && !config.hasApiKey) {
    throw new Error("apiKey 写回校验失败");
  }

  if (patch.env && typeof patch.env === "object") {
    const currentEnv = config.env && typeof config.env === "object" ? config.env : {};
    for (const [key, value] of Object.entries(patch.env)) {
      const expectedExists = Boolean(trimText(value));
      const actualExists = Object.prototype.hasOwnProperty.call(currentEnv, key);
      if (expectedExists && !actualExists) {
        throw new Error(`环境变量写回校验失败：${key}`);
      }
      if (!expectedExists && actualExists) {
        throw new Error(`环境变量删除校验失败：${key}`);
      }
    }
  }
}

async function rollbackOpenClawConfig(pathname, backupPath) {
  if (!pathname || !backupPath) {
    return {
      ok: false,
      message: "缺少回滚路径"
    };
  }
  try {
    await fs.copyFile(backupPath, pathname);
    return {
      ok: true,
      message: "已自动回滚到备份配置"
    };
  } catch (error) {
    return {
      ok: false,
      message: error.message || String(error)
    };
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
      update: { ...defaults.update, ...(payload.update || {}) },
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

app.post("/api/gateway/token/sync", async (request, reply) => {
  try {
    const { config: panelConfig } = await loadPanelConfig();
    const currentConfig = await loadOpenClawConfig(panelConfig.openclaw.config_path);
    const syncResult = await rotateGatewayTokenAndApprovePairings({
      openclawConfig: currentConfig,
      panelConfig,
      configPath: panelConfig.openclaw.config_path,
      saveConfig: saveOpenClawConfig,
      approvePendingPairings: approvePendingGatewayPairings
    });
    const { tokenResult, saved, autoApprove } = syncResult;

    return {
      ok: true,
      result: {
        changed: tokenResult.changed,
        source: tokenResult.source,
        token: tokenResult.token,
        tokenMasked: maskToken(tokenResult.token),
        message: "Gateway Token 已重新生成并写入真实配置文件，已自动尝试批准待处理配对",
        autoApprove,
        path: saved.path,
        backupPath: saved.backupPath
      }
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.get("/api/gateway/token/current", async (request, reply) => {
  try {
    const { config: panelConfig } = await loadPanelConfig();
    const currentConfig = await loadOpenClawConfig(panelConfig.openclaw.config_path);
    const token = readGatewayTokenFromConfig(currentConfig);
    const exists = Boolean(token);

    return {
      ok: true,
      result: {
        exists,
        source: "openclaw-config",
        token,
        tokenMasked: maskToken(token)
      }
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.post("/api/gateway/pairing/approve-pending", async (request, reply) => {
  try {
    const { config: panelConfig } = await loadPanelConfig();
    const result = await approvePendingGatewayPairings({
      panelConfig
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

app.get("/api/openclaw-config/raw", async (request, reply) => {
  try {
    const { config: panelConfig } = await loadPanelConfig();
    const configuredPath = panelConfig?.openclaw?.config_path;
    const realPath = expandHome(configuredPath);

    let rawText = "";
    let mtimeMs = 0;
    let size = 0;
    let exists = true;
    try {
      rawText = await fs.readFile(realPath, "utf8");
      const stats = await fs.stat(realPath);
      mtimeMs = Number(stats.mtimeMs || 0);
      size = Number(stats.size || Buffer.byteLength(rawText, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        exists = false;
      } else {
        throw error;
      }
    }

    return {
      ok: true,
      exists,
      path: realPath,
      rawText,
      mtimeMs,
      size
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.put("/api/openclaw-config/raw", async (request, reply) => {
  try {
    const payload = rawOpenClawConfigPayloadSchema.parse(request.body || {});
    const rawText = String(payload.rawText || "");
    const expectedMtimeMs = Number(payload.expectedMtimeMs);
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      throw new Error(`配置 JSON 解析失败：${error.message}`);
    }

    const { config: panelConfig } = await loadPanelConfig();
    if (Number.isFinite(expectedMtimeMs) && expectedMtimeMs > 0) {
      const realPath = expandHome(panelConfig.openclaw.config_path);
      let currentMtimeMs = 0;
      try {
        const stats = await fs.stat(realPath);
        currentMtimeMs = Number(stats.mtimeMs || 0);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
      if (!Number.isFinite(currentMtimeMs) || Math.abs(currentMtimeMs - expectedMtimeMs) > 1) {
        const conflict = new Error("配置文件已被其他进程更新，请先点“刷新真实配置”再保存。");
        conflict.statusCode = 409;
        throw conflict;
      }
    }

    const saved = await saveOpenClawConfig(panelConfig.openclaw.config_path, parsed);
    const latestRaw = await fs.readFile(saved.path, "utf8");
    const stats = await fs.stat(saved.path);
    const refreshed = await loadOpenClawConfig(panelConfig.openclaw.config_path);

    return {
      ok: true,
      message: "配置文件写入成功",
      path: saved.path,
      backupPath: saved.backupPath,
      rawText: latestRaw,
      mtimeMs: Number(stats.mtimeMs || 0),
      size: Number(stats.size || Buffer.byteLength(latestRaw, "utf8")),
      settings: extractSettings(refreshed)
    };
  } catch (error) {
    reply.code(Number.isInteger(error?.statusCode) ? error.statusCode : 400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.put("/api/models/providers/:providerId", async (request, reply) => {
  try {
    const params = providerPathParamSchema.parse(request.params || {});
    const payload = updateProviderPayloadSchema.parse(request.body || {});
    const { config: panelConfig } = await loadPanelConfig();
    const current = await loadOpenClawConfig(panelConfig.openclaw.config_path);
    const result = updateProviderInCatalog(current, {
      providerId: params.providerId,
      nextProviderId: payload.nextProviderId,
      api: payload.api,
      baseUrl: payload.baseUrl,
      ...(Object.prototype.hasOwnProperty.call(payload, "apiKey") ? { apiKey: payload.apiKey } : {})
    });
    const saved = await saveOpenClawConfig(panelConfig.openclaw.config_path, result.nextConfig);
    return {
      ok: true,
      message: "供应商更新成功",
      providerId: result.providerId,
      primary: result.primary,
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

app.put("/api/models/providers/:providerId/models/:modelId", async (request, reply) => {
  try {
    const params = modelPathParamSchema.parse(request.params || {});
    const payload = updateModelPayloadSchema.parse(request.body || {});
    const { config: panelConfig } = await loadPanelConfig();
    const current = await loadOpenClawConfig(panelConfig.openclaw.config_path);
    const result = updateModelInCatalog(current, {
      providerId: params.providerId,
      modelId: params.modelId,
      nextModelId: payload.nextModelId,
      ...(Object.prototype.hasOwnProperty.call(payload, "name") ? { name: payload.name } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "contextWindow")
        ? { contextWindow: payload.contextWindow }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "maxTokens") ? { maxTokens: payload.maxTokens } : {})
    });
    const saved = await saveOpenClawConfig(panelConfig.openclaw.config_path, result.nextConfig);
    return {
      ok: true,
      message: "模型更新成功",
      providerId: result.providerId,
      modelId: result.modelId,
      modelName: result.modelName,
      primary: result.primary,
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

app.delete("/api/models/providers/:providerId/models/:modelId", async (request, reply) => {
  try {
    const params = modelPathParamSchema.parse(request.params || {});
    const { config: panelConfig } = await loadPanelConfig();
    const current = await loadOpenClawConfig(panelConfig.openclaw.config_path);
    const result = removeModelFromCatalog(current, {
      providerId: params.providerId,
      modelId: params.modelId
    });
    const saved = await saveOpenClawConfig(panelConfig.openclaw.config_path, result.nextConfig);
    return {
      ok: true,
      message: "模型删除成功",
      providerId: result.providerId,
      modelId: result.modelId,
      providerRemoved: result.providerRemoved,
      primary: result.primary,
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

app.delete("/api/models/providers/:providerId", async (request, reply) => {
  try {
    const params = providerPathParamSchema.parse(request.params || {});
    const { config: panelConfig } = await loadPanelConfig();
    const current = await loadOpenClawConfig(panelConfig.openclaw.config_path);
    const result = removeProviderFromCatalog(current, {
      providerId: params.providerId
    });
    const saved = await saveOpenClawConfig(panelConfig.openclaw.config_path, result.nextConfig);
    return {
      ok: true,
      message: "供应商删除成功",
      providerId: result.providerId,
      primary: result.primary,
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

app.put("/api/skills/:skillKey/config", async (request, reply) => {
  try {
    const skillKey = String(request.params?.skillKey || "").trim();
    const rawPatch = skillConfigPatchPayloadSchema.parse(request.body || {});
    const patch = normalizeSkillConfigPatch(rawPatch);
    const { config: panelConfig } = await loadPanelConfig();
    const prepared = await prepareSkillConfigUpdate({
      panelConfig,
      skillKey,
      patch
    });
    const saved = await saveOpenClawConfig(panelConfig.openclaw.config_path, prepared.nextConfig);
    try {
      const config = await getSkillConfig({
        panelConfig,
        skillKey: prepared.skillKey
      });
      validateSkillConfigWriteback({
        patch,
        config
      });
      return {
        ok: true,
        result: {
          skillKey: prepared.skillKey,
          config,
          path: saved.path,
          backupPath: saved.backupPath
        }
      };
    } catch (error) {
      const rollback = await rollbackOpenClawConfig(saved.path, saved.backupPath);
      const rollbackMessage = rollback.ok ? "已自动回滚到写入前版本。" : `自动回滚失败：${rollback.message}`;
      throw new Error(`Skill 配置写入后校验失败：${error.message}。${rollbackMessage}`);
    }
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

app.post("/api/chat/session/new", async (request, reply) => {
  try {
    const payload = chatSessionNewPayloadSchema.parse(request.body || {});
    const { config: panelConfig } = await loadPanelConfig();
    const result = await createChatSession({
      panelConfig,
      keyPrefix: payload.keyPrefix
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

app.post("/api/chat/attachments/stage", async (request, reply) => {
  try {
    const payload = chatAttachmentStagePayloadSchema.parse(request.body || {});
    const { config: panelConfig } = await loadPanelConfig();
    const result = await stageChatAttachment({
      panelConfig,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      base64: payload.base64
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

app.post("/api/channels/telegram/setup", async (request, reply) => {
  try {
    const parsed = telegramSetupPayloadSchema.safeParse(request.body || {});
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        message: parsed.error.issues?.[0]?.message || "请求参数错误"
      };
    }
    const { config: panelConfig } = await loadPanelConfig();
    const result = await setupTelegramBasic({
      panelConfig,
      botToken: parsed.data.botToken
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

app.post("/api/channels/telegram/pairing/approve", async (request, reply) => {
  try {
    const parsed = telegramPairingPayloadSchema.safeParse(request.body || {});
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        message: parsed.error.issues?.[0]?.message || "请求参数错误"
      };
    }
    const { config: panelConfig } = await loadPanelConfig();
    const result = await approveTelegramPairing({
      panelConfig,
      code: parsed.data.code
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
    const query = updateCheckQuerySchema.parse(request.query || {});
    const { config: panelConfig } = await loadPanelConfig();
    const targetConfig = resolveUpdateTarget(panelConfig, query.target);
    const githubToken = trimText(panelConfig?.update?.github_token);
    const result =
      targetConfig.target === "panel"
        ? await checkPanelDirectUpdate({
            releaseRepo: targetConfig.releaseRepo,
            githubToken,
            appDir: targetConfig.panelAppDir
          })
        : await checkBotDirectUpdate({
            runCmd: runCommand,
            releaseRepo: targetConfig.releaseRepo
          });
    return {
      ok: true,
      result: {
        ...result,
        target: targetConfig.target,
        upgradeMode: targetConfig.upgradeMode
      }
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
    const targetConfig = resolveUpdateTarget(panelConfig, payload.target);
    const githubToken = trimText(panelConfig?.update?.github_token);
    let result;
    if (targetConfig.target === "panel") {
      result = await stagePanelDirectUpdate({
        tag: payload.tag,
        releaseRepo: targetConfig.releaseRepo,
        githubToken,
        appDir: targetConfig.panelAppDir
      });
    } else {
      result = await mutateBotDirectUpdate({
        action: "upgrade",
        tag: payload.tag,
        runCmd: runCommand
      });
    }
    return {
      ok: result.ok,
      result: {
        ...result,
        target: targetConfig.target,
        upgradeMode: targetConfig.upgradeMode
      }
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
    const targetConfig = resolveUpdateTarget(panelConfig, payload.target);
    const githubToken = trimText(panelConfig?.update?.github_token);
    let result;
    if (targetConfig.target === "panel") {
      if (!trimText(payload.tag)) {
        throw new Error("回滚必须填写目标版本号");
      }
      result = await stagePanelDirectUpdate({
        tag: payload.tag,
        releaseRepo: targetConfig.releaseRepo,
        githubToken,
        appDir: targetConfig.panelAppDir
      });
      result.action = "rollback-stage";
      result.message = result.ok
        ? `已准备回滚版本包 ${trimText(payload.tag)}，请点击“应用更新并重启”完成回滚。`
        : result.message;
    } else {
      result = await mutateBotDirectUpdate({
        action: "rollback",
        tag: payload.tag,
        runCmd: runCommand
      });
    }
    return {
      ok: result.ok,
      result: {
        ...result,
        target: targetConfig.target,
        upgradeMode: targetConfig.upgradeMode
      }
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

app.post("/api/update/apply", async (request, reply) => {
  try {
    const payload = tagPayloadSchema.parse(request.body || {});
    const { config: panelConfig } = await loadPanelConfig();
    const targetConfig = resolveUpdateTarget(panelConfig, payload.target);
    const githubToken = trimText(panelConfig?.update?.github_token);
    let result;
    if (targetConfig.target === "panel") {
      result = await applyPanelDirectUpdate({
        tag: payload.tag,
        releaseRepo: targetConfig.releaseRepo,
        githubToken,
        appDir: targetConfig.panelAppDir,
        panelServiceName: targetConfig.panelServiceName
      });
    } else {
      result = await mutateBotDirectUpdate({
        action: "upgrade",
        tag: payload.tag,
        runCmd: runCommand
      });
    }
    return {
      ok: result.ok,
      result: {
        ...result,
        target: targetConfig.target,
        upgradeMode: targetConfig.upgradeMode
      }
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      message: error.message
    };
  }
});

const PAGE_FILE_BY_PATH = {
  "/": "pages/dashboard.html",
  "/dashboard": "pages/dashboard.html",
  "/status-overview": "pages/dashboard.html",
  "/skills": "pages/skills.html",
  "/chat-console": "pages/chat-console.html",
  "/model": "pages/model.html",
  "/model/add": "pages/model-add.html",
  "/config-generator": "pages/config-generator.html",
  "/channels": "pages/channels.html",
  "/channels/telegram": "pages/channels-telegram.html",
  "/channels/feishu": "pages/channels-feishu.html",
  "/channels/discord": "pages/channels-discord.html",
  "/channels/slack": "pages/channels-slack.html",
  "/update": "pages/update.html",
  "/service": "pages/service.html",
  "/logs": "pages/logs.html"
};

app.get("/", async (_request, reply) => {
  return reply.sendFile("pages/dashboard.html");
});

app.setNotFoundHandler(async (request, reply) => {
  if (request.raw.url?.startsWith("/api/")) {
    reply.code(404);
    return {
      ok: false,
      message: "API not found"
    };
  }
  const rawUrl = String(request.raw.url || "/");
  const pathname = rawUrl.split("?")[0] || "/";
  const pageFile = PAGE_FILE_BY_PATH[pathname];
  if (pageFile) {
    return reply.sendFile(pageFile);
  }
  return reply.sendFile("index.html");
});

async function main() {
  const { config } = await loadPanelConfig();
  try {
    const permissionSync = await ensureOpenClawConfigPermissions(config.openclaw.config_path);
    if (permissionSync.changed) {
      console.log(
        `[openclaw-config] permission normalized: ownerFixed=${permissionSync.ownerFixed} modeFixed=${permissionSync.modeFixed} path=${permissionSync.path}`
      );
    }
  } catch (error) {
    console.warn(
      `[openclaw-config] failed to normalize config file permission: ${error?.message || String(error)}`
    );
  }
  const host = config.panel.listen_host;
  const port = config.panel.listen_port;

  await app.listen({ host, port });
  console.log(`OpenClaw panel listening on http://${host}:${port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
