const DEFAULT_CONTROL_UI_TUNNEL_URL = "ws://127.0.0.1:19002";

function trimText(value) {
  return String(value || "").trim();
}

function hasScheme(value) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function cloneConfig(value) {
  return JSON.parse(JSON.stringify(value && typeof value === "object" ? value : {}));
}

function toHttpLikeOrigin(rawUrl) {
  const text = trimText(rawUrl) || DEFAULT_CONTROL_UI_TUNNEL_URL;
  const normalizedInput = hasScheme(text) ? text : `http://${text}`;
  let parsed;
  try {
    parsed = new URL(normalizedInput);
  } catch {
    throw new Error("原生 UI 地址格式不正确，请填写类似 ws://127.0.0.1:19002 的地址");
  }

  const protocolMap = {
    "ws:": "http:",
    "wss:": "https:",
    "http:": "http:",
    "https:": "https:"
  };
  const nextProtocol = protocolMap[parsed.protocol];
  if (!nextProtocol) {
    throw new Error("原生 UI 地址必须是 ws://、wss://、http:// 或 https://");
  }

  return new URL(`${nextProtocol}//${parsed.host}`);
}

export function normalizeControlUiOrigins(rawUrl, options = {}) {
  const fallbackUrl = trimText(options.defaultUrl) || DEFAULT_CONTROL_UI_TUNNEL_URL;
  const parsed = toHttpLikeOrigin(trimText(rawUrl) || fallbackUrl);
  const origins = new Set([parsed.origin]);

  if (parsed.hostname === "127.0.0.1") {
    origins.add(`${parsed.protocol}//localhost${parsed.port ? `:${parsed.port}` : ""}`);
  }
  if (parsed.hostname === "localhost") {
    origins.add(`${parsed.protocol}//127.0.0.1${parsed.port ? `:${parsed.port}` : ""}`);
  }

  return {
    input: trimText(rawUrl) || fallbackUrl,
    origin: parsed.origin,
    origins: [...origins].sort()
  };
}

function appendChanged(changes, key, from, to) {
  const before = JSON.stringify(from);
  const after = JSON.stringify(to);
  if (before === after) {
    return;
  }
  changes.push({
    key,
    from,
    to
  });
}

export function buildControlUiSelfHealConfig(openclawConfig, options = {}) {
  const config = cloneConfig(openclawConfig);
  const gateway =
    config.gateway && typeof config.gateway === "object" && !Array.isArray(config.gateway) ? { ...config.gateway } : {};
  const controlUi =
    gateway.controlUi && typeof gateway.controlUi === "object" && !Array.isArray(gateway.controlUi)
      ? { ...gateway.controlUi }
      : {};
  const auth =
    gateway.auth && typeof gateway.auth === "object" && !Array.isArray(gateway.auth) ? { ...gateway.auth } : {};
  const normalizedOrigins = normalizeControlUiOrigins(options.controlUiUrl, options);
  const previousAllowedOrigins = Array.isArray(controlUi.allowedOrigins) ? controlUi.allowedOrigins : [];
  const nextAllowedOrigins = [...new Set([...previousAllowedOrigins, ...normalizedOrigins.origins])].sort();
  const changed = [];

  appendChanged(changed, "gateway.mode", gateway.mode, "local");
  appendChanged(changed, "gateway.bind", gateway.bind, "loopback");
  appendChanged(changed, "gateway.remote", gateway.remote || {}, {});
  appendChanged(changed, "gateway.auth.mode", auth.mode, "none");
  appendChanged(changed, "gateway.controlUi.allowInsecureAuth", controlUi.allowInsecureAuth, true);
  appendChanged(changed, "gateway.controlUi.allowedOrigins", previousAllowedOrigins, nextAllowedOrigins);

  gateway.mode = "local";
  gateway.bind = "loopback";
  gateway.remote = {};
  auth.mode = "none";
  gateway.auth = auth;
  controlUi.allowInsecureAuth = true;
  controlUi.allowedOrigins = nextAllowedOrigins;
  gateway.controlUi = controlUi;
  config.gateway = gateway;

  const addedOrigins = nextAllowedOrigins.filter((item) => !previousAllowedOrigins.includes(item));

  return {
    nextConfig: config,
    changed,
    changedKeys: changed.map((item) => item.key),
    addedOrigins,
    normalizedOrigins: normalizedOrigins.origins,
    requestedOrigin: normalizedOrigins.origin,
    requestedInput: normalizedOrigins.input,
    message:
      changed.length > 0
        ? "已修复原生 UI 本地隧道连接配置"
        : "当前网关配置已符合原生 UI 本地隧道连接要求"
  };
}

