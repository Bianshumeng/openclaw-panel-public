import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { callGatewayRpc, subscribeGatewayEvents } from "./gateway-client.js";
import { expandHome } from "./utils.js";

const CHAT_GATEWAY_TIMEOUT_MS = 1_000;
const CHAT_GATEWAY_RETRIES = 6;
const CHAT_GATEWAY_RETRY_DELAY_MS = 1_000;
const CHAT_ATTACHMENT_TIMEOUT_MS = 120_000;
const ATTACHMENT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const VISION_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/bmp",
  "image/webp",
  "image/gif"
]);

const MIME_EXTENSION_MAP = Object.freeze({
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "application/pdf": ".pdf",
  "application/json": ".json",
  "text/plain": ".txt",
  "text/markdown": ".md"
});

function trimString(value) {
  return String(value || "").trim();
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function inferExtension(fileName, mimeType) {
  const ext = path.extname(String(fileName || "").trim());
  if (ext) {
    return ext;
  }
  const byMime = MIME_EXTENSION_MAP[String(mimeType || "").trim().toLowerCase()];
  if (byMime) {
    return byMime;
  }
  return "";
}

function sanitizeFileName(fileName, fallback = "file") {
  const raw = String(fileName || "").trim();
  if (!raw) {
    return fallback;
  }
  const base = path.basename(raw).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  return base || fallback;
}

function normalizeBase64(input) {
  const value = String(input || "").trim();
  if (!value) {
    return "";
  }
  const maybeDataUrl = value.match(/^data:[^;]+;base64,(.+)$/i);
  return maybeDataUrl ? maybeDataUrl[1].trim() : value;
}

function resolveOutboundMediaDir(panelConfig) {
  const configPath = expandHome(String(panelConfig?.openclaw?.config_path || "~/.openclaw/openclaw.json"));
  const openclawRoot = path.dirname(configPath);
  return path.join(openclawRoot, "media", "outbound");
}

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function resolveGatewayMediaRoot(panelConfig) {
  const explicit = trimString(
    panelConfig?.openclaw?.gateway_media_root || process.env.OPENCLAW_GATEWAY_MEDIA_ROOT || ""
  );
  if (explicit) {
    return explicit;
  }
  if (trimString(panelConfig?.runtime?.mode) === "docker") {
    return "/home/node/.openclaw";
  }
  const configPath = expandHome(String(panelConfig?.openclaw?.config_path || "~/.openclaw/openclaw.json"));
  return path.dirname(configPath);
}

function mapLocalPathToGatewayPath(panelConfig, absoluteLocalPath) {
  const localOpenclawRoot = path.resolve(path.dirname(expandHome(String(panelConfig?.openclaw?.config_path || "~/.openclaw/openclaw.json"))));
  const relative = path.relative(localOpenclawRoot, absoluteLocalPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return toPosixPath(absoluteLocalPath);
  }
  const gatewayRoot = toPosixPath(resolveGatewayMediaRoot(panelConfig)).replace(/\/+$/, "");
  const relativePosix = toPosixPath(relative).replace(/^\/+/, "");
  return `${gatewayRoot}/${relativePosix}`;
}

function buildMediaSendPayload(panelConfig, attachments = [], deps = {}) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length === 0) {
    return {
      imageAttachments: [],
      fileReferences: []
    };
  }

  const checkExists = deps.existsSync || existsSync;
  const readBuffer = deps.readFileSync || readFileSync;
  const allowedOutboundDir = path.resolve(resolveOutboundMediaDir(panelConfig));
  const imageAttachments = [];
  const fileReferences = [];

  list.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`附件 #${index + 1} 格式错误`);
    }

    const filePath = trimString(item.stagedPath || item.filePath);
    const fileName = sanitizeFileName(item.fileName, `file-${index + 1}`);
    const mimeType = trimString(item.mimeType).toLowerCase() || "application/octet-stream";

    if (!filePath) {
      throw new Error(`附件缺少 stagedPath：${fileName}`);
    }
    const resolvedFilePath = path.resolve(filePath);
    const normalizedAllowed = process.platform === "win32" ? allowedOutboundDir.toLowerCase() : allowedOutboundDir;
    const normalizedResolved = process.platform === "win32" ? resolvedFilePath.toLowerCase() : resolvedFilePath;
    const allowedPrefix = `${normalizedAllowed}${path.sep}`;
    if (normalizedResolved !== normalizedAllowed && !normalizedResolved.startsWith(allowedPrefix)) {
      throw new Error(`附件路径非法：${fileName}`);
    }
    if (!checkExists(resolvedFilePath)) {
      throw new Error(`附件文件不存在：${fileName}`);
    }

    const gatewayFilePath = mapLocalPathToGatewayPath(panelConfig, resolvedFilePath);
    fileReferences.push(`[media attached: ${gatewayFilePath} (${mimeType}) | ${gatewayFilePath}]`);

    if (!VISION_MIME_TYPES.has(mimeType)) {
      return;
    }
    const fileBuffer = readBuffer(resolvedFilePath);
    imageAttachments.push({
      content: fileBuffer.toString("base64"),
      mimeType,
      fileName
    });
  });

  return {
    imageAttachments,
    fileReferences
  };
}

async function callChatRpc(panelConfig, method, params, deps = {}, options = {}) {
  const callRpc = deps.callGatewayRpc || callGatewayRpc;
  const gatewayToken = trimString(deps.gatewayToken ?? process.env.OPENCLAW_GATEWAY_TOKEN);
  return await callRpc({
    panelConfig,
    method,
    params: params || {},
    expectFinal: options.expectFinal === true,
    timeoutMs: toPositiveInt(options.timeoutMs, CHAT_GATEWAY_TIMEOUT_MS),
    retries: toPositiveInt(options.retries, CHAT_GATEWAY_RETRIES),
    retryDelayMs: toPositiveInt(options.retryDelayMs, CHAT_GATEWAY_RETRY_DELAY_MS),
    token: gatewayToken
  });
}

function normalizeSessionItem(item) {
  return {
    key: trimString(item?.key),
    displayName: trimString(item?.displayName || item?.key),
    kind: trimString(item?.kind),
    updatedAt: Number(item?.updatedAt || 0) || 0,
    sessionId: trimString(item?.sessionId),
    modelProvider: trimString(item?.modelProvider),
    model: trimString(item?.model),
    contextTokens: Number(item?.contextTokens || 0) || null,
    totalTokens: Number(item?.totalTokens || 0) || null,
    abortedLastRun: item?.abortedLastRun === true
  };
}

function getCanonicalSessionPrefix(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const canonical = list.find((item) => trimString(item?.key).startsWith("agent:"));
  if (!canonical) {
    return "";
  }
  const parts = trimString(canonical.key).split(":");
  if (parts.length < 2) {
    return "";
  }
  return `${parts[0]}:${parts[1]}`;
}

function normalizeSessionPrefix(value) {
  const raw = trimString(value).replace(/:+$/, "");
  if (!raw) {
    return "";
  }
  if (raw.includes(":")) {
    return raw;
  }
  return `agent:${raw}`;
}

function buildSessionKey(prefix) {
  const finalPrefix = normalizeSessionPrefix(prefix) || "agent:main";
  return `${finalPrefix}:session-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function normalizeChatEventPayload(eventFrame) {
  const payload = eventFrame?.payload && typeof eventFrame.payload === "object" ? eventFrame.payload : {};
  return {
    type: "chat",
    event: "chat",
    seq: Number(eventFrame?.seq || 0) || null,
    at: Date.now(),
    runId: trimString(payload?.runId),
    sessionKey: trimString(payload?.sessionKey),
    state: trimString(payload?.state),
    stopReason: trimString(payload?.stopReason),
    errorMessage: trimString(payload?.errorMessage),
    message: payload?.message && typeof payload.message === "object" ? payload.message : payload?.message ?? null
  };
}

function normalizeAgentEventPayload(eventFrame) {
  const payload = eventFrame?.payload && typeof eventFrame.payload === "object" ? eventFrame.payload : {};
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  return {
    type: "agent",
    event: "agent",
    seq: Number(eventFrame?.seq || 0) || null,
    at: Date.now(),
    runId: trimString(payload?.runId),
    sessionKey: trimString(payload?.sessionKey),
    stream: trimString(payload?.stream),
    phase: trimString(data?.phase),
    data
  };
}

function isTerminalChatState(state) {
  return state === "final" || state === "error" || state === "aborted";
}

export async function listChatSessions({ panelConfig, deps = {} }) {
  const payload = await callChatRpc(panelConfig, "sessions.list", {}, deps);
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions.map((item) => normalizeSessionItem(item)) : [];
  return {
    total: Number(payload?.count || sessions.length) || sessions.length,
    sessions
  };
}

export async function getChatHistory({
  panelConfig,
  sessionKey,
  limit = 200,
  deps = {}
}) {
  const normalizedSessionKey = trimString(sessionKey);
  if (!normalizedSessionKey) {
    throw new Error("sessionKey 不能为空");
  }

  const payload = await callChatRpc(
    panelConfig,
    "chat.history",
    {
      sessionKey: normalizedSessionKey,
      limit: toPositiveInt(limit, 200)
    },
    deps
  );

  return {
    sessionKey: normalizedSessionKey,
    sessionId: trimString(payload?.sessionId),
    thinkingLevel: trimString(payload?.thinkingLevel),
    verboseLevel: trimString(payload?.verboseLevel),
    messages: Array.isArray(payload?.messages) ? payload.messages : []
  };
}

export async function sendChatMessage({
  panelConfig,
  sessionKey,
  message,
  thinking = "",
  attachments = [],
  idempotencyKey = "",
  timeoutMs,
  deps = {}
}) {
  const normalizedSessionKey = trimString(sessionKey);
  const normalizedMessage = trimString(message);
  if (!normalizedSessionKey) {
    throw new Error("sessionKey 不能为空");
  }
  if (!normalizedMessage && (!Array.isArray(attachments) || attachments.length === 0)) {
    throw new Error("message 或 attachments 至少填一个");
  }

  const finalIdempotencyKey = trimString(idempotencyKey) || randomUUID();
  const { imageAttachments, fileReferences } = buildMediaSendPayload(panelConfig, attachments, deps);
  const refs = fileReferences.join("\n");
  const finalMessage = refs ? (normalizedMessage ? `${normalizedMessage}\n\n${refs}` : refs) : normalizedMessage;
  const resolvedTimeout = toPositiveInt(timeoutMs, imageAttachments.length > 0 ? CHAT_ATTACHMENT_TIMEOUT_MS : CHAT_GATEWAY_TIMEOUT_MS);

  const payload = await callChatRpc(
    panelConfig,
    "chat.send",
    {
      sessionKey: normalizedSessionKey,
      message: finalMessage,
      thinking: trimString(thinking),
      attachments: imageAttachments,
      idempotencyKey: finalIdempotencyKey
    },
    deps,
    {
      timeoutMs: resolvedTimeout
    }
  );

  return {
    sessionKey: normalizedSessionKey,
    runId: trimString(payload?.runId),
    status: trimString(payload?.status),
    idempotencyKey: finalIdempotencyKey
  };
}

export async function stageChatAttachment({
  panelConfig,
  fileName,
  mimeType = "application/octet-stream",
  base64,
  deps = {}
}) {
  const normalizedBase64 = normalizeBase64(base64);
  if (!normalizedBase64) {
    throw new Error("base64 不能为空");
  }

  let buffer;
  try {
    buffer = Buffer.from(normalizedBase64, "base64");
  } catch {
    throw new Error("base64 格式无效");
  }
  if (!buffer || buffer.length === 0) {
    throw new Error("附件内容为空");
  }

  const safeName = sanitizeFileName(fileName);
  const normalizedMimeType = trimString(mimeType).toLowerCase() || "application/octet-stream";
  const ext = inferExtension(safeName, normalizedMimeType);
  const id = randomUUID();
  const outboundDir = resolveOutboundMediaDir(panelConfig);
  const stagedPath = path.join(outboundDir, `${id}${ext}`);

  const makeDir = deps.mkdir || mkdir;
  const write = deps.writeFile || writeFile;
  await makeDir(outboundDir, { recursive: true });
  await write(stagedPath, buffer, { mode: 0o644 });

  const preview = normalizedMimeType.startsWith("image/") && buffer.length <= ATTACHMENT_PREVIEW_MAX_BYTES
    ? `data:${normalizedMimeType};base64,${normalizedBase64}`
    : null;

  return {
    id,
    fileName: safeName,
    mimeType: normalizedMimeType,
    fileSize: buffer.length,
    stagedPath,
    preview
  };
}

export async function createChatSession({
  panelConfig,
  keyPrefix = "",
  deps = {}
}) {
  let resolvedPrefix = normalizeSessionPrefix(keyPrefix);
  if (!resolvedPrefix) {
    try {
      const listed = await listChatSessions({ panelConfig, deps });
      resolvedPrefix = getCanonicalSessionPrefix(listed?.sessions);
    } catch {
      resolvedPrefix = "";
    }
  }
  const sessionKey = buildSessionKey(resolvedPrefix || "agent:main");
  const result = await resetChatSession({
    panelConfig,
    sessionKey,
    reason: "new",
    deps
  });
  return {
    key: trimString(result?.key || sessionKey),
    entry: result?.entry && typeof result.entry === "object" ? result.entry : {}
  };
}

export async function abortChatRun({
  panelConfig,
  sessionKey,
  runId = "",
  deps = {}
}) {
  const normalizedSessionKey = trimString(sessionKey);
  if (!normalizedSessionKey) {
    throw new Error("sessionKey 不能为空");
  }

  const payload = await callChatRpc(
    panelConfig,
    "chat.abort",
    {
      sessionKey: normalizedSessionKey,
      ...(trimString(runId) ? { runId: trimString(runId) } : {})
    },
    deps
  );

  return {
    sessionKey: normalizedSessionKey,
    aborted: payload?.aborted === true,
    runIds: Array.isArray(payload?.runIds) ? payload.runIds : []
  };
}

export async function resetChatSession({
  panelConfig,
  sessionKey,
  reason = "new",
  deps = {}
}) {
  const normalizedSessionKey = trimString(sessionKey);
  if (!normalizedSessionKey) {
    throw new Error("sessionKey 不能为空");
  }
  const normalizedReason = reason === "reset" ? "reset" : "new";

  const payload = await callChatRpc(
    panelConfig,
    "sessions.reset",
    {
      key: normalizedSessionKey,
      reason: normalizedReason
    },
    deps
  );

  return {
    key: trimString(payload?.key || normalizedSessionKey),
    entry: payload?.entry && typeof payload.entry === "object" ? payload.entry : {}
  };
}

export function createChatEventSubscription({
  panelConfig,
  sessionKey,
  includeAgent = true,
  deps = {},
  onEvent,
  onError,
  onClose
}) {
  const subscribeEvents = deps.subscribeGatewayEvents || subscribeGatewayEvents;
  const gatewayToken = trimString(deps.gatewayToken ?? process.env.OPENCLAW_GATEWAY_TOKEN);
  const normalizedSessionKey = trimString(sessionKey);
  if (!normalizedSessionKey) {
    throw new Error("sessionKey 不能为空");
  }

  return subscribeEvents({
    panelConfig,
    token: gatewayToken,
    onEvent: (eventFrame) => {
      const eventName = trimString(eventFrame?.event);
      if (!eventName) {
        return;
      }

      if (eventName === "chat") {
        const normalized = normalizeChatEventPayload(eventFrame);
        if (normalized.sessionKey !== normalizedSessionKey) {
          return;
        }
        onEvent?.(normalized);
        if (isTerminalChatState(normalized.state)) {
          onEvent?.({
            type: "terminal",
            event: "terminal",
            at: Date.now(),
            runId: normalized.runId,
            sessionKey: normalized.sessionKey,
            state: normalized.state
          });
        }
        return;
      }

      if (includeAgent && eventName === "agent") {
        const normalized = normalizeAgentEventPayload(eventFrame);
        if (normalized.sessionKey !== normalizedSessionKey) {
          return;
        }
        onEvent?.(normalized);
      }
    },
    onError,
    onClose
  });
}
