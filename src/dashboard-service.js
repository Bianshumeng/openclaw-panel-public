import { extractSettings } from "./openclaw-config.js";
import { callGatewayRpc } from "./gateway-client.js";
import { runServiceAction } from "./systemd.js";

const DASHBOARD_GATEWAY_TIMEOUT_MS = 1_000;
const DASHBOARD_GATEWAY_RETRIES = 6;
const DASHBOARD_GATEWAY_RETRY_DELAY_MS = 1_000;

function trimString(value) {
  return String(value || "").trim();
}

function toBoolean(value) {
  return value === true;
}

function summarizeModel(modelSettings = {}) {
  const providers = Array.isArray(modelSettings?.catalog?.providers) ? modelSettings.catalog.providers : [];
  const providerItems = providers.map((provider) => {
    const models = Array.isArray(provider?.models) ? provider.models : [];
    return {
      id: trimString(provider?.id),
      api: trimString(provider?.api),
      baseUrl: trimString(provider?.baseUrl),
      modelCount: models.length,
      models: models.map((model) => ({
        id: trimString(model?.id),
        name: trimString(model?.name || model?.id),
        contextWindow: Number(model?.contextWindow || 0) || null,
        maxTokens: Number(model?.maxTokens || 0) || null,
        thinkingStrength: trimString(model?.thinkingStrength) || "无"
      }))
    };
  });
  const totalModels = providerItems.reduce((sum, item) => sum + item.modelCount, 0);
  return {
    primaryRef: trimString(modelSettings?.primary),
    current: {
      providerId: trimString(modelSettings?.providerId),
      modelId: trimString(modelSettings?.modelId),
      modelName: trimString(modelSettings?.modelName || modelSettings?.modelId),
      contextWindow: Number(modelSettings?.contextWindow || 0) || null,
      maxTokens: Number(modelSettings?.maxTokens || 0) || null,
      thinkingStrength: trimString(modelSettings?.thinkingStrength) || "无"
    },
    counts: {
      providers: providerItems.length,
      models: totalModels
    },
    providers: providerItems
  };
}

function summarizeConfiguredChannels(channelSettings = {}) {
  const channelKeys = ["telegram", "feishu", "discord", "slack"];
  const items = channelKeys.map((key) => {
    const raw = channelSettings?.[key] && typeof channelSettings[key] === "object" ? channelSettings[key] : {};
    return {
      id: key,
      enabled: toBoolean(raw.enabled),
      dmPolicy: trimString(raw.dmPolicy),
      groupPolicy: trimString(raw.groupPolicy)
    };
  });
  const enabled = items.filter((item) => item.enabled).length;
  return {
    total: items.length,
    enabled,
    disabled: items.length - enabled,
    items
  };
}

function summarizeGatewayChannelRuntime(payload) {
  const channels = payload?.channels && typeof payload.channels === "object" ? payload.channels : {};
  const channelOrder = Array.isArray(payload?.channelOrder) ? payload.channelOrder : Object.keys(channels);
  const channelLabels = payload?.channelLabels && typeof payload.channelLabels === "object" ? payload.channelLabels : {};
  const items = channelOrder.map((id) => {
    const raw = channels[id] && typeof channels[id] === "object" ? channels[id] : {};
    return {
      id,
      label: trimString(channelLabels[id] || id),
      configured: toBoolean(raw.configured),
      running: toBoolean(raw.running),
      lastError: trimString(raw.lastError),
      lastProbeAt: raw.lastProbeAt ?? null
    };
  });
  const running = items.filter((item) => item.running).length;
  return {
    ok: true,
    total: items.length,
    running,
    stopped: items.length - running,
    items
  };
}

function summarizeSkills(payload) {
  const skills = Array.isArray(payload?.skills) ? payload.skills : [];
  const items = skills.map((skill) => ({
    key: trimString(skill?.skillKey || skill?.name),
    name: trimString(skill?.name),
    enabled: !toBoolean(skill?.disabled),
    eligible: toBoolean(skill?.eligible),
    blocked: toBoolean(skill?.blockedByAllowlist),
    source: trimString(skill?.source),
    updatedAt: skill?.updatedAt ?? null
  }));
  const enabled = items.filter((item) => item.enabled).length;
  const eligible = items.filter((item) => item.eligible).length;
  const blocked = items.filter((item) => item.blocked).length;
  return {
    ok: true,
    total: items.length,
    enabled,
    disabled: items.length - enabled,
    eligible,
    blocked,
    items
  };
}

function normalizeRpcError(error) {
  if (!error) {
    return "gateway rpc failed";
  }
  return trimString(error.message || error) || "gateway rpc failed";
}

async function loadGatewaySummary(panelConfig, gatewayToken, callRpc) {
  const [channelsResult, skillsResult] = await Promise.allSettled([
    callRpc({
      panelConfig,
      method: "channels.status",
      params: {},
      timeoutMs: DASHBOARD_GATEWAY_TIMEOUT_MS,
      retries: DASHBOARD_GATEWAY_RETRIES,
      retryDelayMs: DASHBOARD_GATEWAY_RETRY_DELAY_MS,
      token: gatewayToken
    }),
    callRpc({
      panelConfig,
      method: "skills.status",
      params: {},
      timeoutMs: DASHBOARD_GATEWAY_TIMEOUT_MS,
      retries: DASHBOARD_GATEWAY_RETRIES,
      retryDelayMs: DASHBOARD_GATEWAY_RETRY_DELAY_MS,
      token: gatewayToken
    })
  ]);

  const channels =
    channelsResult.status === "fulfilled"
      ? summarizeGatewayChannelRuntime(channelsResult.value)
      : {
          ok: false,
          total: 0,
          running: 0,
          stopped: 0,
          items: [],
          message: normalizeRpcError(channelsResult.reason)
        };
  const skills =
    skillsResult.status === "fulfilled"
      ? summarizeSkills(skillsResult.value)
      : {
          ok: false,
          total: 0,
          enabled: 0,
          disabled: 0,
          eligible: 0,
          blocked: 0,
          items: [],
          message: normalizeRpcError(skillsResult.reason)
        };

  return { channels, skills };
}

async function loadRuntimeSummary(panelConfig, runAction) {
  try {
    const result = await runAction("status", panelConfig);
    return {
      ok: toBoolean(result?.ok),
      active: toBoolean(result?.active),
      mode: trimString(panelConfig?.runtime?.mode) || "systemd",
      message: trimString(result?.message || result?.output)
    };
  } catch (error) {
    return {
      ok: false,
      active: false,
      mode: trimString(panelConfig?.runtime?.mode) || "systemd",
      message: trimString(error?.message || error)
    };
  }
}

export async function buildDashboardSummary({
  panelConfig,
  openclawConfig,
  deps = {}
}) {
  const readSettings = deps.extractSettings || extractSettings;
  const runAction = deps.runServiceAction || runServiceAction;
  const callRpc = deps.callGatewayRpc || callGatewayRpc;
  const gatewayToken = trimString(deps.gatewayToken ?? process.env.OPENCLAW_GATEWAY_TOKEN);

  const settings = readSettings(openclawConfig);
  const runtime = await loadRuntimeSummary(panelConfig, runAction);
  const gateway = await loadGatewaySummary(panelConfig, gatewayToken, callRpc);

  return {
    generatedAt: new Date().toISOString(),
    model: summarizeModel(settings.model),
    channels: {
      configured: summarizeConfiguredChannels(settings.channels),
      runtime: gateway.channels
    },
    skills: gateway.skills,
    runtime
  };
}
