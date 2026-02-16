import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_GATEWAY_PORT = 18_789;
const PROTOCOL_VERSION = 3;
const DEVICE_IDENTITY_VERSION = 1;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function trimString(value) {
  return String(value || "").trim();
}

function resolveHomePath(filePath) {
  const value = trimString(filePath);
  if (!value) {
    return value;
  }
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function safeParseJson(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, payload) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // best-effort permissions
    }
  } catch {
    // ignore write failures; runtime can continue with in-memory identity
  }
}

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  const normalized = String(input || "").replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function derivePublicKeyRaw(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" });
  if (
    Buffer.isBuffer(spki) &&
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return Buffer.from(spki);
}

function publicKeyRawBase64UrlFromPem(publicKeyPem) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function fingerprintPublicKey(publicKeyPem) {
  return crypto.createHash("sha256").update(derivePublicKeyRaw(publicKeyPem)).digest("hex");
}

function generateDeviceIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return {
    deviceId: fingerprintPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem
  };
}

function resolveDefaultStateDir(panelConfig, env = process.env) {
  const configPath = resolveHomePath(
    trimString(env.OPENCLAW_CONFIG_PATH) || trimString(panelConfig?.openclaw?.config_path)
  );
  if (configPath) {
    return path.dirname(configPath);
  }
  return path.join(os.homedir(), ".openclaw");
}

function resolveGatewayIdentityPath(panelConfig, env = process.env) {
  const override = resolveHomePath(trimString(env.OPENCLAW_DEVICE_IDENTITY_PATH));
  if (override) {
    return override;
  }
  return path.join(resolveDefaultStateDir(panelConfig, env), "identity", "device.json");
}

function resolveGatewayDeviceAuthPath(identityPath) {
  return path.join(path.dirname(identityPath), "device-auth.json");
}

function loadOrCreateDeviceIdentity(identityPath) {
  const parsed = safeParseJson(identityPath);
  if (
    parsed?.version === DEVICE_IDENTITY_VERSION &&
    typeof parsed.deviceId === "string" &&
    typeof parsed.publicKeyPem === "string" &&
    typeof parsed.privateKeyPem === "string"
  ) {
    const derivedId = fingerprintPublicKey(parsed.publicKeyPem);
    const normalized = {
      version: DEVICE_IDENTITY_VERSION,
      deviceId: derivedId,
      publicKeyPem: parsed.publicKeyPem,
      privateKeyPem: parsed.privateKeyPem,
      createdAtMs: toPositiveInt(parsed.createdAtMs, Date.now())
    };
    if (parsed.deviceId !== derivedId) {
      writeJsonFile(identityPath, normalized);
    }
    return normalized;
  }
  const generated = generateDeviceIdentity();
  const stored = {
    version: DEVICE_IDENTITY_VERSION,
    ...generated,
    createdAtMs: Date.now()
  };
  writeJsonFile(identityPath, stored);
  return stored;
}

function loadStoredDeviceToken(identityPath, role) {
  const parsed = safeParseJson(resolveGatewayDeviceAuthPath(identityPath));
  const token = parsed?.tokens?.[role]?.token;
  return typeof token === "string" ? trimString(token) : "";
}

function buildDeviceAuthPayload({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce }) {
  const version = nonce ? "v2" : "v1";
  const normalizedScopes = Array.isArray(scopes) ? scopes.map((value) => trimString(value)).filter(Boolean) : [];
  const base = [
    version,
    trimString(deviceId),
    trimString(clientId),
    trimString(clientMode),
    trimString(role),
    normalizedScopes.join(","),
    String(toPositiveInt(signedAtMs, Date.now())),
    trimString(token)
  ];
  if (version === "v2") {
    base.push(trimString(nonce));
  }
  return base.join("|");
}

function signDevicePayload(privateKeyPem, payload) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(String(payload || ""), "utf8"), privateKey);
  return base64UrlEncode(signature);
}

function buildConnectDevice({ deviceIdentity, token, role, scopes, nonce }) {
  if (!deviceIdentity || !deviceIdentity.deviceId || !deviceIdentity.publicKeyPem || !deviceIdentity.privateKeyPem) {
    return undefined;
  }
  const signedAt = Date.now();
  try {
    const clientId = "cli";
    const clientMode = "cli";
    const payload = buildDeviceAuthPayload({
      deviceId: deviceIdentity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs: signedAt,
      token,
      nonce
    });
    return {
      id: deviceIdentity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(deviceIdentity.publicKeyPem),
      signature: signDevicePayload(deviceIdentity.privateKeyPem, payload),
      signedAt,
      ...(nonce ? { nonce } : {})
    };
  } catch {
    return undefined;
  }
}

export class GatewayRpcError extends Error {
  constructor(message, options = {}) {
    const text = String(message || "gateway rpc error");
    super(text);
    this.name = "GatewayRpcError";
    this.type = options.type || "unknown";
    this.method = options.method || "";
    this.code = options.code || "";
    this.attempt = toPositiveInt(options.attempt, 1);
    this.details = options.details || {};
    this.cause = options.cause;
  }
}

export function resolveGatewayWsUrl(panelConfig, env = process.env) {
  const envOverride = trimString(env.OPENCLAW_GATEWAY_WS_URL);
  if (envOverride) {
    return envOverride;
  }

  const explicit = trimString(panelConfig?.openclaw?.gateway_ws_url);
  if (explicit) {
    return explicit;
  }

  const runtime = trimString(panelConfig?.runtime?.mode) || "systemd";
  const host =
    runtime === "docker"
      ? trimString(panelConfig?.openclaw?.container_name) ||
        trimString(panelConfig?.openclaw?.service_name) ||
        "openclaw-gateway"
      : "127.0.0.1";
  const envPort =
    runtime === "docker" ? trimString(env.OPENCLAW_GATEWAY_CONTAINER_PORT) : trimString(env.OPENCLAW_GATEWAY_PORT);
  const port =
    toPositiveInt(envPort, 0) ||
    toPositiveInt(panelConfig?.openclaw?.gateway_port, 0) ||
    DEFAULT_GATEWAY_PORT;
  return `ws://${host}:${port}/ws`;
}

function categorizeErrorType(message, remoteError) {
  const text = String(message || "").toLowerCase();
  const remoteCode = String(remoteError?.code || "").toLowerCase();
  if (
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("auth") ||
    remoteCode.includes("unauthorized") ||
    remoteCode.includes("forbidden")
  ) {
    return "auth";
  }
  if (remoteError) {
    return "remote";
  }
  if (text.includes("timeout")) {
    return "timeout";
  }
  if (
    text.includes("closed") ||
    text.includes("connect") ||
    text.includes("socket") ||
    text.includes("network") ||
    text.includes("econn")
  ) {
    return "network";
  }
  if (text.includes("parse") || text.includes("json") || text.includes("protocol")) {
    return "protocol";
  }
  return "unknown";
}

export function normalizeGatewayError(error, context = {}) {
  if (error instanceof GatewayRpcError) {
    return error;
  }
  const message = String(error?.message || error || "gateway rpc error");
  const remoteError = context.remoteError;
  return new GatewayRpcError(message, {
    type: categorizeErrorType(message, remoteError),
    code: trimString(remoteError?.code),
    method: trimString(context.method),
    attempt: toPositiveInt(context.attempt, 1),
    details: {
      url: trimString(context.url),
      closeCode: context.closeCode,
      closeReason: trimString(context.closeReason),
      remoteError
    },
    cause: error
  });
}

function isRetryable(error) {
  const type = error instanceof GatewayRpcError ? error.type : "unknown";
  return type === "timeout" || type === "network" || type === "protocol";
}

function buildConnectParams({ token, password, nonce, role, scopes, deviceIdentity }) {
  const auth = {};
  if (trimString(token)) {
    auth.token = trimString(token);
  }
  if (trimString(password)) {
    auth.password = trimString(password);
  }
  const hasAuth = Object.keys(auth).length > 0;
  return {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: {
      id: "cli",
      displayName: "openclaw-panel",
      version: "0.1.0",
      platform: process.platform,
      mode: "cli",
      instanceId: randomUUID()
    },
    caps: [],
    role,
    scopes,
    device: buildConnectDevice({
      deviceIdentity,
      token,
      role,
      scopes,
      nonce
    }),
    ...(hasAuth ? { auth } : {})
  };
}

function resolveGatewayAuthContext(panelConfig, token, role) {
  const identityPath = resolveGatewayIdentityPath(panelConfig);
  const deviceIdentity = loadOrCreateDeviceIdentity(identityPath);
  const tokenWithFallback = trimString(token) || loadStoredDeviceToken(identityPath, role);
  return {
    identityPath,
    deviceIdentity,
    tokenWithFallback
  };
}

async function requestGatewayOnce({
  url,
  method,
  params,
  expectFinal,
  timeoutMs,
  token,
  password,
  role,
  scopes,
  deviceIdentity,
  attempt
}) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const connectRequestIds = new Set();
    let rpcRequestId = "";
    let settled = false;
    let connected = false;
    let connectSent = false;
    let timeoutHandle = null;
    let connectDelayHandle = null;
    const connectDelayMs = Math.min(750, Math.max(0, Math.floor(timeoutMs / 5)));

    const clearTimers = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      timeoutHandle = null;
      if (connectDelayHandle) {
        clearTimeout(connectDelayHandle);
      }
      connectDelayHandle = null;
    };

    const finish = (error, payload) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      try {
        ws.close();
      } catch {
        // ignore close failure
      }
      if (error) {
        reject(normalizeGatewayError(error, { method, url, attempt }));
      } else {
        resolve(payload);
      }
    };

    const failWithContext = (error, context = {}) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      try {
        ws.close();
      } catch {
        // ignore close failure
      }
      reject(
        normalizeGatewayError(error, {
          method,
          url,
          attempt,
          ...context
        })
      );
    };

    const sendConnect = (nonce = "") => {
      if (settled || connected || connectSent || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      connectSent = true;
      const id = randomUUID();
      connectRequestIds.add(id);
      ws.send(
        JSON.stringify({
          type: "req",
          id,
          method: "connect",
          params: buildConnectParams({
            token,
            password,
            nonce,
            role,
            scopes,
            deviceIdentity
          })
        })
      );
    };

    const sendRpc = () => {
      if (settled || !connected || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      rpcRequestId = randomUUID();
      ws.send(
        JSON.stringify({
          type: "req",
          id: rpcRequestId,
          method,
          params: params ?? {}
        })
      );
    };

    timeoutHandle = setTimeout(() => {
      failWithContext(new Error(`gateway rpc timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on("open", () => {
      connectDelayHandle = setTimeout(() => {
        sendConnect("");
      }, connectDelayMs);
    });

    ws.on("error", (error) => {
      failWithContext(new Error(`gateway socket error: ${error.message || String(error)}`));
    });

    ws.on("close", (code, reason) => {
      if (settled) {
        return;
      }
      failWithContext(new Error(`gateway closed (${code}): ${String(reason || "").trim() || "no reason"}`), {
        closeCode: code,
        closeReason: String(reason || "")
      });
    });

    ws.on("message", (raw) => {
      if (settled) {
        return;
      }

      let frame;
      try {
        frame = JSON.parse(String(raw || ""));
      } catch (error) {
        failWithContext(new Error(`gateway protocol parse error: ${error.message || String(error)}`));
        return;
      }

      const frameType = trimString(frame?.type).toLowerCase();

      if (frameType === "evt" || frameType === "event") {
        if (frame?.event === "connect.challenge") {
          const nonce = trimString(frame?.payload?.nonce);
          sendConnect(nonce);
        }
        return;
      }

      if (frameType !== "res") {
        return;
      }

      if (!connected && connectRequestIds.has(frame.id)) {
        if (!frame.ok) {
          failWithContext(new Error(frame?.error?.message || "gateway connect rejected"), {
            remoteError: frame?.error || {}
          });
          return;
        }
        connected = true;
        connectRequestIds.clear();
        sendRpc();
        return;
      }

      if (!rpcRequestId || frame.id !== rpcRequestId) {
        return;
      }

      if (!frame.ok) {
        failWithContext(new Error(frame?.error?.message || "gateway rpc failed"), {
          remoteError: frame?.error || {}
        });
        return;
      }

      if (expectFinal && frame?.payload?.status === "accepted") {
        return;
      }

      finish(null, frame.payload);
    });
  });
}

export async function callGatewayRpc({
  panelConfig,
  url,
  method,
  params = {},
  expectFinal = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  token = "",
  password = "",
  role = "operator",
  scopes = ["operator.admin", "operator.approvals", "operator.pairing"]
}) {
  const targetUrl = trimString(url) || resolveGatewayWsUrl(panelConfig);
  const { deviceIdentity, tokenWithFallback } = resolveGatewayAuthContext(panelConfig, token, role);
  const maxAttempts = Math.max(1, toPositiveInt(retries, DEFAULT_RETRIES) + 1);
  const effectiveTimeoutMs = toPositiveInt(timeoutMs, DEFAULT_TIMEOUT_MS);
  const effectiveRetryDelayMs = toPositiveInt(retryDelayMs, DEFAULT_RETRY_DELAY_MS);

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await requestGatewayOnce({
        url: targetUrl,
        method,
        params,
        expectFinal: Boolean(expectFinal),
        timeoutMs: effectiveTimeoutMs,
        token: tokenWithFallback,
        password,
        role,
        scopes,
        deviceIdentity,
        attempt
      });
    } catch (error) {
      const normalized = normalizeGatewayError(error, {
        method,
        url: targetUrl,
        attempt
      });
      lastError = normalized;
      if (attempt >= maxAttempts || !isRetryable(normalized)) {
        throw normalized;
      }
      await wait(effectiveRetryDelayMs);
    }
  }

  throw lastError || new GatewayRpcError("gateway rpc failed", { type: "unknown", method });
}

export function subscribeGatewayEvents({
  panelConfig,
  url,
  token = "",
  password = "",
  role = "operator",
  scopes = ["operator.admin", "operator.approvals", "operator.pairing"],
  connectDelayMs = 750,
  onEvent,
  onError,
  onClose
}) {
  const targetUrl = trimString(url) || resolveGatewayWsUrl(panelConfig);
  const { deviceIdentity, tokenWithFallback } = resolveGatewayAuthContext(panelConfig, token, role);
  const connectRequestIds = new Set();
  let ws = null;
  let closed = false;
  let connected = false;
  let connectSent = false;
  let connectDelayHandle = null;
  let readySettled = false;
  let readyResolve;
  let readyReject;

  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const settleReady = (error) => {
    if (readySettled) {
      return;
    }
    readySettled = true;
    if (error) {
      readyReject(error);
      return;
    }
    readyResolve({
      url: targetUrl
    });
  };

  const clearTimers = () => {
    if (connectDelayHandle) {
      clearTimeout(connectDelayHandle);
      connectDelayHandle = null;
    }
  };

  const notifyError = (error, context = {}) => {
    const normalized = normalizeGatewayError(error, {
      url: targetUrl,
      method: "connect",
      ...context
    });
    onError?.(normalized);
    settleReady(normalized);
  };

  const sendConnect = (nonce = "") => {
    if (closed || connected || connectSent || !ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    connectSent = true;
    const id = randomUUID();
    connectRequestIds.add(id);
    ws.send(
      JSON.stringify({
        type: "req",
        id,
        method: "connect",
        params: buildConnectParams({
          token: tokenWithFallback,
          password,
          nonce,
          role,
          scopes,
          deviceIdentity
        })
      })
    );
  };

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearTimers();
    try {
      ws?.close();
    } catch {
      // ignore close failure
    }
  };

  ws = new WebSocket(targetUrl);
  ws.on("open", () => {
    if (closed) {
      return;
    }
    const effectiveConnectDelayMs = Math.max(0, Math.min(5000, toPositiveInt(connectDelayMs, 750)));
    connectDelayHandle = setTimeout(() => {
      sendConnect("");
    }, effectiveConnectDelayMs);
  });

  ws.on("error", (error) => {
    notifyError(new Error(`gateway socket error: ${error.message || String(error)}`));
  });

  ws.on("close", (code, reason) => {
    clearTimers();
    const reasonText = String(reason || "").trim() || "no reason";
    if (!connected && !closed) {
      settleReady(
        normalizeGatewayError(new Error(`gateway closed (${code}): ${reasonText}`), {
          url: targetUrl,
          method: "connect",
          closeCode: code,
          closeReason: reasonText
        })
      );
    }
    onClose?.({
      code,
      reason: reasonText
    });
  });

  ws.on("message", (raw) => {
    if (closed) {
      return;
    }

    let frame;
    try {
      frame = JSON.parse(String(raw || ""));
    } catch (error) {
      notifyError(new Error(`gateway protocol parse error: ${error.message || String(error)}`));
      return;
    }

    const frameType = trimString(frame?.type).toLowerCase();
    if (frameType === "evt" || frameType === "event") {
      if (frame?.event === "connect.challenge") {
        const nonce = trimString(frame?.payload?.nonce);
        connectSent = false;
        sendConnect(nonce);
        return;
      }
      if (connected) {
        onEvent?.(frame);
      }
      return;
    }

    if (frameType !== "res") {
      return;
    }
    if (!connectRequestIds.has(frame.id)) {
      return;
    }
    connectRequestIds.delete(frame.id);
    if (!frame.ok) {
      notifyError(new Error(frame?.error?.message || "gateway connect rejected"), {
        remoteError: frame?.error || {}
      });
      close();
      return;
    }

    connected = true;
    settleReady(null);
  });

  return {
    ready,
    close,
    get connected() {
      return connected;
    }
  };
}
