import { requestJson } from "./app-api.js";
import { PANEL_ROUTES, isKnownPanelPath, panelByPath } from "./app-routes.js";
import {
  AICODECAT_PROVIDER,
  apiModeFamily,
  resolveAicodecatBaseUrl,
  resolveProviderId,
  convertConfig
} from "./config-generator.js";

let stream = null;
const THEME_KEY = "openclaw-panel-theme";
const DASHBOARD_CONTEXT_KEY = "openclaw-panel-dashboard-context-tokens";
const MODEL_TEMPLATE_MAP = {
  "aicodecat-gpt": {
    title: "GPT 系列模板",
    providerId: "aicodecat-gpt",
    api: "openai-responses",
    baseUrl: "https://aicode.cat/v1",
    models: [
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 400000,
        maxTokens: 128000
      },
      {
        id: "gpt-5.2-codex",
        name: "GPT-5.2 Codex",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 400000,
        maxTokens: 128000
      },
      {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 400000,
        maxTokens: 128000
      }
    ]
  },
  "aicodecat-claude": {
    title: "Claude 系列模板",
    providerId: "aicodecat-claude",
    api: "anthropic-messages",
    baseUrl: "https://aicode.cat",
    models: [
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 64000
      },
      {
        id: "claude-sonnet-4-5-20250929",
        name: "Claude Sonnet 4.5",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 64000
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 64000
      }
    ]
  },
  "aicodecat-gemini": {
    title: "Gemini 系列模板",
    providerId: "aicodecat-gemini",
    api: "google-generative-ai",
    baseUrl: "https://aicode.cat/v1beta",
    models: [
      {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro Preview",
        reasoning: false,
        input: ["text", "image"],
        contextWindow: 1048576,
        maxTokens: 65536
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash Preview",
        reasoning: false,
        input: ["text", "image"],
        contextWindow: 1048576,
        maxTokens: 65536
      }
    ]
  }
};

const MODEL_PROFILE_BY_FAMILY = Object.freeze({
  gpt: {
    apiMode: "openai-responses",
    contextWindow: 400000,
    maxTokens: 128000
  },
  claude: {
    apiMode: "anthropic-messages",
    contextWindow: 200000,
    maxTokens: 64000
  },
  gemini: {
    apiMode: "google-generative-ai",
    contextWindow: 1048576,
    maxTokens: 65536
  }
});

const DEFAULT_MODEL_OPTIONS = Object.freeze(
  Object.values(MODEL_TEMPLATE_MAP)
    .flatMap((template) => template.models || [])
    .reduce((acc, item) => {
      const id = String(item?.id || "").trim();
      if (!id || acc.some((entry) => entry.id === id)) {
        return acc;
      }
      acc.push({
        id,
        name: String(item?.name || id).trim() || id
      });
      return acc;
    }, [])
);

const modelEditorState = {
  modelCatalog: {
    providers: [],
    modelRefs: []
  },
  defaultModelRefs: [],
  currentModelSettings: null,
  currentModelPayload: null,
  providerMode: "template",
  dashboardBound: false
};

const dashboardSummaryState = {
  errorCount: null,
  latestError: "",
  currentTag: "",
  latestTag: "",
  updateAvailable: false,
  updateWarning: ""
};

const skillsPageState = {
  bound: false,
  selectedSkillKey: "",
  selectedSkillConfig: null,
  skills: []
};

const chatConsoleState = {
  bound: false,
  selectedSessionKey: "",
  sessions: [],
  lastRunId: "",
  streamSource: null,
  streamSessionKey: "",
  streamLines: [],
  streamDeltasByRunId: {},
  streamThinkingByRunId: {},
  historyMessages: [],
  sending: false,
  attachments: [],
  staging: false
};

const els = {
  messages: document.querySelector("#messages"),
  serviceOutput: document.querySelector("#service_output"),
  logOutput: document.querySelector("#log_output"),
  errorSummary: document.querySelector("#error_summary"),
  runtimeState: document.querySelector("#runtime_state"),
  metaServiceName: document.querySelector("#meta_service_name"),
  metaLogSource: document.querySelector("#meta_log_source"),
  dashboardPublicHint: document.querySelector("#dashboard_public_hint"),
  serviceState: document.querySelector("#service_state"),
  serviceHint: document.querySelector("#service_hint"),
  themeToggle: document.querySelector("#theme_toggle"),
  updateState: document.querySelector("#update_state"),
  updateHint: document.querySelector("#update_hint"),
  updateCurrentTag: document.querySelector("#update_current_tag"),
  updateLatestTag: document.querySelector("#update_latest_tag")
};

function setMessage(message, type = "info") {
  const line = `[${new Date().toLocaleTimeString()}][${type}] ${message}`;
  els.messages.textContent = `${line}\n${els.messages.textContent}`.slice(0, 12000);
}

function setInput(id, value) {
  const el = document.querySelector(`#${id}`);
  if (!el) {
    return;
  }
  if (el.type === "checkbox") {
    el.checked = Boolean(value);
    return;
  }
  el.value = value ?? "";
}

function setText(id, value) {
  const el = document.querySelector(`#${id}`);
  if (!el) {
    return;
  }
  el.textContent = value ?? "";
}

function getInputValue(id) {
  const el = document.querySelector(`#${id}`);
  if (!el) {
    return "";
  }
  if (el.type === "checkbox") {
    return el.checked;
  }
  return el.value;
}

async function api(url, options = {}) {
  return requestJson(fetch, url, options);
}

function setupTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = Array.from(document.querySelectorAll(".panel"));

  const activate = (panelName, { push = false, replace = false } = {}) => {
    tabs.forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.tabTarget === panelName);
    });
    panels.forEach((panel) => {
      panel.classList.toggle("is-visible", panel.dataset.panel === panelName);
    });

    const route = PANEL_ROUTES[panelName] || "/model";
    if (push && window.location.pathname !== route) {
      window.history.pushState({ panel: panelName }, "", route);
    } else if (replace && window.location.pathname !== route) {
      window.history.replaceState({ panel: panelName }, "", route);
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", (event) => {
      event.preventDefault();
      activate(tab.dataset.tabTarget, { push: true });
    });
  });

  window.addEventListener("popstate", () => {
    activate(panelByPath(window.location.pathname));
  });

  const initialPanel = panelByPath(window.location.pathname);
  const shouldNormalizePath = !isKnownPanelPath(window.location.pathname);
  activate(initialPanel, { replace: shouldNormalizePath });
}

function applyTheme(theme) {
  const value = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = value;
  if (els.themeToggle) {
    els.themeToggle.textContent = value === "dark" ? "切换到白色模式" : "切换到深夜模式";
  }
}

function setupTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved || "light");

  els.themeToggle?.addEventListener("click", () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    setMessage(`界面已切换到${next === "dark" ? "深夜模式" : "白色模式"}`, "info");
  });
}

function setupConfigGenerator() {
  const providerEl = document.querySelector("#cfg_provider");
  const providerCustomEl = document.querySelector("#cfg_provider_custom");
  const apiModeEl = document.querySelector("#cfg_apimode");
  const apiModeCustomEl = document.querySelector("#cfg_apimode_custom");
  const baseUrlEl = document.querySelector("#cfg_baseurl");
  const baseUrlCustomEl = document.querySelector("#cfg_baseurl_custom");
  const modelIdEl = document.querySelector("#cfg_model_id");
  const modelIdCustomEl = document.querySelector("#cfg_model_id_custom");
  const apiKeyEl = document.querySelector("#cfg_apikey");
  const inheritExistingEl = document.querySelector("#cfg_inherit_existing");
  const configInputEl = document.querySelector("#cfg_input");
  const outputEl = document.querySelector("#cfg_output");
  const statusEl = document.querySelector("#cfg_status");
  const generateBtn = document.querySelector("#cfg_generate");
  const copyBtn = document.querySelector("#cfg_copy");

  if (
    !providerEl ||
    !apiModeEl ||
    !baseUrlEl ||
    !modelIdEl ||
    !apiKeyEl ||
    !inheritExistingEl ||
    !configInputEl ||
    !outputEl ||
    !statusEl
  ) {
    return;
  }

  const fillGeneratorModelOptions = () => {
    fillDefaultModelOptions(modelIdEl, {
      includeCustom: true,
      selectedValue: String(modelIdEl.value || "").trim()
    });
  };

  fillGeneratorModelOptions();

  const modelByFamily = {
    gpt: DEFAULT_MODEL_OPTIONS.find((item) => modelFamilyById(item.id) === "gpt")?.id || "gpt-5.2",
    claude: DEFAULT_MODEL_OPTIONS.find((item) => modelFamilyById(item.id) === "claude")?.id || "claude-sonnet-4-5-20250929",
    gemini: DEFAULT_MODEL_OPTIONS.find((item) => modelFamilyById(item.id) === "gemini")?.id || "gemini-3-pro-preview"
  };

  const updateCustomFieldVisibility = (selectEl, inputEl) => {
    if (!selectEl || !inputEl) {
      return;
    }
    const useCustom = selectEl.value === "custom";
    inputEl.classList.toggle("is-visible", useCustom);
  };

  const getFieldValue = (selectEl, customEl) => {
    if (!selectEl) {
      return "";
    }
    if (selectEl.value === "custom") {
      return String(customEl?.value || "").trim();
    }
    return String(selectEl.value || "").trim();
  };

  const setStatus = (text) => {
    statusEl.value = text;
  };

  const syncBaseUrlAndModelForAicodecat = () => {
    const provider = getFieldValue(providerEl, providerCustomEl);
    const apiMode = getFieldValue(apiModeEl, apiModeCustomEl);
    if (provider !== AICODECAT_PROVIDER) {
      return;
    }

    if (baseUrlEl.value !== "custom") {
      baseUrlEl.value = resolveAicodecatBaseUrl(apiMode);
      updateCustomFieldVisibility(baseUrlEl, baseUrlCustomEl);
    }

    if (modelIdEl.value !== "custom") {
      const family = apiModeFamily(apiMode);
      modelIdEl.value = modelByFamily[family] || modelByFamily.gpt;
      updateCustomFieldVisibility(modelIdEl, modelIdCustomEl);
    }
  };

  [providerEl, apiModeEl, baseUrlEl, modelIdEl].forEach((selectEl) => {
    const customEl = document.querySelector(`#${selectEl.id}_custom`);
    selectEl.addEventListener("change", () => {
      updateCustomFieldVisibility(selectEl, customEl);
      if (selectEl === providerEl || selectEl === apiModeEl) {
        syncBaseUrlAndModelForAicodecat();
      }
    });
    updateCustomFieldVisibility(selectEl, customEl);
  });

  copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(outputEl.textContent || "");
      copyBtn.textContent = "已复制";
      window.setTimeout(() => {
        copyBtn.textContent = "复制结果";
      }, 1200);
    } catch {
      copyBtn.textContent = "复制失败";
      window.setTimeout(() => {
        copyBtn.textContent = "复制结果";
      }, 1200);
    }
  });

  generateBtn?.addEventListener("click", () => {
    const payload = {
      config: String(configInputEl.value || "").trim(),
      baseurl: getFieldValue(baseUrlEl, baseUrlCustomEl),
      apikey: String(apiKeyEl.value || "").trim(),
      apimode: getFieldValue(apiModeEl, apiModeCustomEl),
      provider: getFieldValue(providerEl, providerCustomEl),
      model_id: getFieldValue(modelIdEl, modelIdCustomEl),
      inherit_existing: String(inheritExistingEl.value || "").trim() === "true"
    };

    if (!payload.config) {
      outputEl.textContent = "错误: 请输入原始 Config JSON";
      setStatus("失败");
      return;
    }
    if (!payload.baseurl) {
      outputEl.textContent = "错误: 请选择或输入 Base URL";
      setStatus("失败");
      return;
    }
    if (!payload.apikey) {
      outputEl.textContent = "错误: 请输入 API Key";
      setStatus("失败");
      return;
    }
    if (!payload.provider || !payload.apimode || !payload.model_id) {
      outputEl.textContent = "错误: provider / apimode / model_id 不能为空";
      setStatus("失败");
      return;
    }

    setStatus("处理中");
    try {
      const result = convertConfig(payload);
      outputEl.textContent = JSON.stringify(result, null, 2);
      setStatus("完成");
      setMessage("配置生成完成（仅前端本地转换）", "ok");
    } catch (error) {
      outputEl.textContent = `错误: ${error.message || String(error)}`;
      setStatus("失败");
      setMessage(`配置生成失败：${error.message || String(error)}`, "error");
    }
  });

  syncBaseUrlAndModelForAicodecat();
}

function fillPanelMeta(config, deployment = {}) {
  const runtime = config.runtime?.mode || "systemd";
  const target =
    runtime === "docker" ? config.openclaw.container_name || config.openclaw.service_name : config.openclaw.service_name;
  els.metaServiceName.textContent = `target: ${target}`;
  els.metaLogSource.textContent = `log: ${config.log.source} (${runtime})`;
  setInput("dashboard_panel_local_url", deployment.panelLocalUrl || "-");
  setInput("dashboard_panel_public_url", deployment.panelPublicUrl || "未配置（请填写公网 IP + 端口）");
  setInput("dashboard_gateway_public_url", deployment.gatewayPublicUrl || "未配置（请填写公网 IP + 端口）");
  setInput("dashboard_webhook_base_url", deployment.webhookBaseUrl || "未配置（请填写公网 IP + 端口）");
  if (els.dashboardPublicHint) {
    if (deployment.hasPublicEndpoint && deployment.hasWebhookEndpoint) {
      els.dashboardPublicHint.textContent = "公网访问地址与 Webhook 回调基地址已就绪，可直接复制到外部平台。";
    } else {
      els.dashboardPublicHint.innerHTML =
        "若为空，请在 <code>data/panel/panel.config.json</code> 的 <code>reverse_proxy</code> 中填写公网 IP 与端口。";
    }
  }
  els.serviceHint.textContent =
    runtime === "docker" ? "当前为 Docker 运行时，按钮将控制容器。" : "当前为 systemd 运行时，按钮将控制服务。";
}

function setUpdateState(text, mode = "info") {
  els.updateState.textContent = text;
  els.updateState.classList.toggle("success", mode === "success");
  els.updateState.classList.toggle("fail", mode === "fail");
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeModelDraft(rawModel) {
  const id = String(rawModel?.id || "").trim();
  const name = String(rawModel?.name || id).trim() || id;
  if (!id) {
    return null;
  }
  const normalized = {
    ...rawModel,
    id,
    name,
    contextWindow: toPositiveInt(rawModel?.contextWindow, 200000),
    maxTokens: toPositiveInt(rawModel?.maxTokens, 8192)
  };
  if (Array.isArray(rawModel?.input)) {
    normalized.input = [...new Set(rawModel.input.map((item) => String(item).trim()).filter(Boolean))];
  }
  if (rawModel?.reasoning !== undefined) {
    normalized.reasoning = Boolean(rawModel.reasoning);
  }
  return normalized;
}

function buildModelPayload({
  primary,
  providerId,
  providerApi,
  providerBaseUrl,
  providerApiKey = "",
  modelId,
  modelName,
  contextWindow,
  maxTokens,
  providerModels = []
}) {
  return {
    primary: String(primary || "").trim(),
    providerId: String(providerId || "").trim(),
    providerApi: String(providerApi || "").trim(),
    providerBaseUrl: String(providerBaseUrl || "").trim(),
    providerApiKey: String(providerApiKey || "").trim(),
    modelId: String(modelId || "").trim(),
    modelName: String(modelName || modelId || "").trim(),
    contextWindow: toPositiveInt(contextWindow, 200000),
    maxTokens: toPositiveInt(maxTokens, 8192),
    providerModels: Array.isArray(providerModels)
      ? providerModels.map((item) => normalizeModelDraft(item)).filter(Boolean)
      : []
  };
}

function modelFamilyById(modelId) {
  const value = String(modelId || "").trim().toLowerCase();
  if (value.startsWith("claude-")) {
    return "claude";
  }
  if (value.startsWith("gemini-")) {
    return "gemini";
  }
  return "gpt";
}

function buildDefaultModelEntry(modelId, modelName = "") {
  const id = String(modelId || "").trim();
  if (!id) {
    return null;
  }
  const family = modelFamilyById(id);
  const profile = MODEL_PROFILE_BY_FAMILY[family] || MODEL_PROFILE_BY_FAMILY.gpt;
  const providerApi = profile.apiMode;
  const providerId = resolveProviderId(AICODECAT_PROVIDER, providerApi);
  return {
    ref: `${providerId}/${id}`,
    providerId,
    providerApi,
    providerBaseUrl: resolveAicodecatBaseUrl(providerApi),
    modelId: id,
    modelName: String(modelName || id).trim() || id,
    contextWindow: profile.contextWindow,
    maxTokens: profile.maxTokens
  };
}

function fillDefaultModelOptions(selectEl, { includeCustom = false, selectedValue = "" } = {}) {
  if (!(selectEl instanceof HTMLSelectElement)) {
    return "";
  }

  const currentValue = String(selectedValue || selectEl.value || "").trim();
  selectEl.innerHTML = "";
  DEFAULT_MODEL_OPTIONS.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.id;
    selectEl.appendChild(option);
  });

  if (includeCustom) {
    const customOption = document.createElement("option");
    customOption.value = "custom";
    customOption.textContent = "自定义";
    selectEl.appendChild(customOption);
  }

  if (DEFAULT_MODEL_OPTIONS.some((item) => item.id === currentValue)) {
    selectEl.value = currentValue;
  } else if (includeCustom && currentValue === "custom") {
    selectEl.value = "custom";
  } else {
    selectEl.value = DEFAULT_MODEL_OPTIONS[0]?.id || (includeCustom ? "custom" : "");
  }

  return String(selectEl.value || "").trim();
}

function readGeneratorDefaultModelRefs() {
  const modelSelect = document.querySelector("#cfg_model_id");
  if (!modelSelect) {
    return [];
  }

  return Array.from(modelSelect.options || [])
    .map((option) => String(option.value || "").trim())
    .filter((value) => value && value !== "custom")
    .map((value) => buildDefaultModelEntry(value, value))
    .filter(Boolean);
}

function toNonNegativeInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}

function parseModelRef(ref) {
  const value = String(ref || "").trim();
  if (!value.includes("/")) {
    return {
      providerId: "",
      modelId: value
    };
  }
  const [providerId, modelId] = value.split("/", 2);
  return {
    providerId: String(providerId || "").trim(),
    modelId: String(modelId || "").trim()
  };
}

function getDashboardContextTokens() {
  const inputs = Array.from(document.querySelectorAll("[data-dashboard-context-input]"));
  for (const input of inputs) {
    const parsed = toNonNegativeInt(input?.value || "");
    if (parsed !== null) {
      return parsed;
    }
  }
  return toNonNegativeInt(localStorage.getItem(DASHBOARD_CONTEXT_KEY) || "");
}

function formatLocalTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "-";
  }
  return new Date(timestamp).toLocaleString();
}

function setStackListEmpty(container, message) {
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const empty = document.createElement("p");
  empty.className = "muted-line";
  empty.textContent = message;
  container.appendChild(empty);
}

function buildModelEntryFromProvider(providerEntry, providerModel) {
  return {
    ref: `${providerEntry.id}/${providerModel.id}`,
    providerId: providerEntry.id,
    providerApi: providerEntry.api,
    providerBaseUrl: providerEntry.baseUrl,
    modelId: providerModel.id,
    modelName: providerModel.name || providerModel.id,
    contextWindow: Number(providerModel.contextWindow || 0) || undefined,
    maxTokens: Number(providerModel.maxTokens || 0) || undefined,
    thinkingStrength: String(providerModel?.thinkingStrength || "").trim() || "无"
  };
}

function collectCatalogModelEntries(modelSettings) {
  const providers = Array.isArray(modelSettings?.catalog?.providers) ? modelSettings.catalog.providers : [];
  const entries = [];
  providers.forEach((providerEntry) => {
    const models = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
    models.forEach((providerModel) => {
      entries.push(buildModelEntryFromProvider(providerEntry, providerModel));
    });
  });
  return entries;
}

function findModelEntryByRef(modelSettings, modelRef) {
  const targetRef = String(modelRef || "").trim();
  if (!targetRef) {
    return null;
  }

  const matched = collectCatalogModelEntries(modelSettings).find((entry) => entry.ref === targetRef);
  if (matched) {
    return matched;
  }

  if (String(modelSettings?.primary || "").trim() === targetRef) {
    return {
      ref: targetRef,
      providerId: modelSettings?.providerId,
      providerApi: modelSettings?.providerApi,
      providerBaseUrl: modelSettings?.providerBaseUrl,
      modelId: modelSettings?.modelId,
      modelName: modelSettings?.modelName || modelSettings?.modelId,
      contextWindow: Number(modelSettings?.contextWindow || 0) || undefined,
      maxTokens: Number(modelSettings?.maxTokens || 0) || undefined,
      thinkingStrength: String(modelSettings?.thinkingStrength || "").trim() || "无"
    };
  }

  return null;
}

function confirmModelSwitchRisk(modelSettings, modelEntry) {
  const currentModelContext = Number(modelSettings?.contextWindow || 0) || undefined;
  const targetContext = Number(modelEntry?.contextWindow || 0) || undefined;
  const currentContextTokens = getDashboardContextTokens();

  if (targetContext && currentContextTokens !== null && currentContextTokens > targetContext) {
    return window.confirm(
      `当前会话上下文约 ${currentContextTokens.toLocaleString()}，目标模型上限为 ${targetContext.toLocaleString()}。\n切换后可能因上下文超限报错，确认继续切换吗？`
    );
  }

  if (targetContext && currentContextTokens === null && currentModelContext && currentModelContext > targetContext) {
    return window.confirm(
      `目标模型上下文上限更小（${targetContext.toLocaleString()}），但你还没填写“当前会话上下文”。\n如果当前会话已超过目标上限，切换后会报错。确认继续切换吗？`
    );
  }

  return true;
}

function resolveProviderSavePrimaryRef(targetPrimaryRef, toggleInputId) {
  const targetRef = String(targetPrimaryRef || "").trim();
  const currentPrimary = String(
    modelEditorState.currentModelSettings?.primary || modelEditorState.currentModelPayload?.primary || ""
  ).trim();
  const shouldSwitchPrimary = Boolean(getInputValue(toggleInputId));
  if (shouldSwitchPrimary) {
    return targetRef || currentPrimary;
  }
  return currentPrimary || targetRef;
}

async function switchDefaultModelByEntry(modelSettings, modelEntry, successPrefix = "已切换默认模型到") {
  if (!modelEntry?.ref || !modelEntry?.modelId) {
    throw new Error("目标模型无效，请重新选择");
  }
  if (!confirmModelSwitchRisk(modelSettings, modelEntry)) {
    return;
  }

  const payload = buildModelPayload({
    primary: modelEntry.ref,
    providerId: modelEntry.providerId,
    providerApi: modelEntry.providerApi,
    providerBaseUrl: modelEntry.providerBaseUrl,
    providerApiKey: "",
    modelId: modelEntry.modelId,
    modelName: modelEntry.modelName || modelEntry.modelId,
    contextWindow: modelEntry.contextWindow || 200000,
    maxTokens: modelEntry.maxTokens || 8192,
    providerModels: []
  });

  await saveModelSettings(payload, `${successPrefix} ${modelEntry.modelId}`);
}

function renderDashboardQuickSwitchHint(modelEntry) {
  if (!modelEntry) {
    setText("dashboard_quick_switch_hint", "请选择目标模型后再切换。");
    return;
  }
  const contextText = modelEntry.contextWindow ? `${Number(modelEntry.contextWindow).toLocaleString()} tokens` : "-";
  setText(
    "dashboard_quick_switch_hint",
    `目标模型：${modelEntry.modelName || modelEntry.modelId} | 提供商：${modelEntry.providerId || "-"} | 上下文上限：${contextText} | 思考强度：${
      modelEntry.thinkingStrength || "无"
    }`
  );
}

function fillDashboardQuickSwitch(modelSettings) {
  const select = document.querySelector("#dashboard_quick_model_ref");
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }

  const entries = [];
  const seen = new Set();
  modelEditorState.defaultModelRefs.forEach((entry) => {
    const ref = String(entry?.ref || "").trim();
    if (!ref || seen.has(ref)) {
      return;
    }
    const fullEntry = findModelEntryByRef(modelSettings, ref) || entry;
    entries.push(fullEntry);
    seen.add(ref);
  });

  const currentPrimary = String(modelSettings?.primary || "").trim();
  if (entries.length === 0 && currentPrimary) {
    const fallbackEntry = findModelEntryByRef(modelSettings, currentPrimary);
    if (fallbackEntry) {
      entries.push(fallbackEntry);
    }
  }

  select.innerHTML = "";
  entries.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.ref;
    option.textContent = entry.modelName || entry.modelId || entry.ref;
    select.appendChild(option);
  });

  if (entries.some((entry) => entry.ref === currentPrimary)) {
    select.value = currentPrimary;
  } else if (entries.length > 0) {
    select.selectedIndex = 0;
  }

  const selectedEntry = entries.find((entry) => entry.ref === select.value) || entries[0] || null;
  renderDashboardQuickSwitchHint(selectedEntry);
}

function setModelProviderMode(mode) {
  const normalizedMode = String(mode || "").trim() === "custom" ? "custom" : "template";
  modelEditorState.providerMode = normalizedMode;

  const hintText =
    normalizedMode === "custom"
      ? "当前为自定义模式：请手工维护 models JSON，适合高级配置场景。"
      : "当前为基础配置模式：你通常只需要填写提供商名称、API 地址和 API Key。";
  setText("model_provider_mode_hint", hintText);

  document.querySelectorAll("[data-model-provider-mode]").forEach((button) => {
    const buttonMode = String(button.getAttribute("data-model-provider-mode") || "").trim();
    const isActive = buttonMode === normalizedMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  document.querySelectorAll("[data-model-provider-mode-panel]").forEach((section) => {
    const panelMode = String(section.getAttribute("data-model-provider-mode-panel") || "").trim();
    section.classList.toggle("is-hidden", panelMode !== normalizedMode);
  });
}

function collectChannelSettings() {
  return {
    telegram: {
      enabled: Boolean(getInputValue("tg_enabled")),
      botToken: String(getInputValue("tg_bot_token") || ""),
      dmPolicy: String(getInputValue("tg_dm_policy") || "pairing"),
      allowFrom: String(getInputValue("tg_allow_from") || ""),
      groupPolicy: String(getInputValue("tg_group_policy") || "allowlist"),
      groupAllowFrom: String(getInputValue("tg_group_allow_from") || ""),
      requireMention: Boolean(getInputValue("tg_require_mention")),
      streamMode: String(getInputValue("tg_stream_mode") || "partial")
    },
    feishu: {
      enabled: Boolean(getInputValue("fs_enabled")),
      appId: String(getInputValue("fs_app_id") || ""),
      appSecret: String(getInputValue("fs_app_secret") || ""),
      domain: String(getInputValue("fs_domain") || "feishu"),
      connectionMode: String(getInputValue("fs_connection_mode") || "websocket"),
      dmPolicy: String(getInputValue("fs_dm_policy") || "pairing"),
      allowFrom: String(getInputValue("fs_allow_from") || ""),
      groupPolicy: String(getInputValue("fs_group_policy") || "allowlist"),
      groupAllowFrom: String(getInputValue("fs_group_allow_from") || ""),
      requireMention: Boolean(getInputValue("fs_require_mention"))
    },
    discord: {
      enabled: Boolean(getInputValue("dc_enabled")),
      token: String(getInputValue("dc_token") || ""),
      dmPolicy: String(getInputValue("dc_dm_policy") || "pairing"),
      allowFrom: String(getInputValue("dc_allow_from") || ""),
      groupPolicy: String(getInputValue("dc_group_policy") || "allowlist"),
      allowBots: Boolean(getInputValue("dc_allow_bots")),
      requireMention: Boolean(getInputValue("dc_require_mention"))
    },
    slack: {
      enabled: Boolean(getInputValue("sl_enabled")),
      mode: String(getInputValue("sl_mode") || "socket"),
      botToken: String(getInputValue("sl_bot_token") || ""),
      appToken: String(getInputValue("sl_app_token") || ""),
      signingSecret: String(getInputValue("sl_signing_secret") || ""),
      dmPolicy: String(getInputValue("sl_dm_policy") || "pairing"),
      allowFrom: String(getInputValue("sl_allow_from") || ""),
      groupPolicy: String(getInputValue("sl_group_policy") || "allowlist"),
      allowBots: Boolean(getInputValue("sl_allow_bots")),
      requireMention: Boolean(getInputValue("sl_require_mention"))
    }
  };
}

function renderModelSummary(entry, primary) {
  const fallback = entry || {};
  setInput("model_current_primary", primary || "");
  setInput("model_current_provider", fallback.providerId || "");
  setInput("model_current_api", fallback.providerApi || "");
  setInput("model_current_baseurl", fallback.providerBaseUrl || "");
  setInput("model_current_id", fallback.modelId || "");
  setInput("model_current_name", fallback.modelName || fallback.modelId || "");
  setInput("model_current_context_window", fallback.contextWindow || "");
  setInput("model_current_max_tokens", fallback.maxTokens || "");
}

function renderDashboardModelCards(modelSettings) {
  const container = document.querySelector("#model_provider_cards");
  if (!container) {
    return;
  }

  const providers = Array.isArray(modelSettings?.catalog?.providers) ? modelSettings.catalog.providers : [];
  const primaryRef = String(modelSettings?.primary || "").trim();
  const currentRefParts = parseModelRef(primaryRef);
  container.innerHTML = "";

  if (providers.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted-line";
    empty.textContent = "当前配置没有可用提供商和模型。";
    container.appendChild(empty);
    return;
  }

  providers.forEach((providerEntry) => {
    const card = document.createElement("article");
    card.className = "provider-card";

    const header = document.createElement("div");
    header.className = "provider-header";
    const title = document.createElement("h3");
    title.className = "provider-title";
    title.textContent = providerEntry.id || "(未命名提供商)";
    const meta = document.createElement("p");
    meta.className = "provider-meta";
    meta.textContent = `API: ${providerEntry.api || "-"} | Base URL: ${providerEntry.baseUrl || "-"}`;
    header.appendChild(title);
    header.appendChild(meta);
    card.appendChild(header);

    const modelList = document.createElement("div");
    modelList.className = "model-list";
    const models = Array.isArray(providerEntry.models) ? providerEntry.models : [];
    models.forEach((providerModel) => {
      const modelEntry = buildModelEntryFromProvider(providerEntry, providerModel);
      const isCurrent = modelEntry.ref === primaryRef;

      const row = document.createElement("div");
      row.className = `model-row${isCurrent ? " is-current" : ""}`;

      const top = document.createElement("div");
      top.className = "model-row-top";
      const modelId = document.createElement("div");
      modelId.className = "model-id";
      modelId.textContent = modelEntry.modelId;
      top.appendChild(modelId);
      if (isCurrent) {
        const currentTag = document.createElement("span");
        currentTag.className = "tag-current";
        currentTag.textContent = "当前使用";
        top.appendChild(currentTag);
      }
      row.appendChild(top);

      const modelMeta = document.createElement("div");
      modelMeta.className = "model-meta";
      const contextText =
        modelEntry.contextWindow && modelEntry.contextWindow > 0
          ? `Context: ${modelEntry.contextWindow.toLocaleString()}`
          : "Context: -";
      const maxText = modelEntry.maxTokens && modelEntry.maxTokens > 0 ? `Max Output: ${modelEntry.maxTokens.toLocaleString()}` : "Max Output: -";
      const thinkingText = `思考强度: ${modelEntry.thinkingStrength || "无"}`;
      modelMeta.textContent = `${contextText} | ${maxText} | ${thinkingText}`;
      row.appendChild(modelMeta);

      const switchBtn = document.createElement("button");
      switchBtn.type = "button";
      switchBtn.className = "model-switch-btn";
      switchBtn.textContent = isCurrent ? "已在使用" : "切换到这个模型";
      switchBtn.disabled = isCurrent;
      switchBtn.addEventListener("click", () => {
        switchDefaultModelByEntry(modelSettings, modelEntry).catch((error) => setMessage(error.message || String(error), "error"));
      });
      row.appendChild(switchBtn);

      modelList.appendChild(row);
    });

    if (models.length === 0) {
      const emptyModel = document.createElement("p");
      emptyModel.className = "muted-line";
      emptyModel.textContent = "该提供商未配置模型。";
      modelList.appendChild(emptyModel);
    }

    card.appendChild(modelList);
    container.appendChild(card);
  });

  const currentModelLabel = modelSettings.modelId || currentRefParts.modelId || "-";
  setInput("dashboard_current_model", currentModelLabel);
  setInput("dashboard_current_provider", modelSettings.providerId || currentRefParts.providerId || "-");
  setInput(
    "dashboard_current_context_window",
    modelSettings.contextWindow ? `${Number(modelSettings.contextWindow).toLocaleString()} tokens` : "-"
  );
  setInput("dashboard_current_thinking_strength", modelSettings.thinkingStrength || "无");
}

function setupDashboard() {
  if (modelEditorState.dashboardBound) {
    return;
  }
  modelEditorState.dashboardBound = true;
  const contextInputs = Array.from(document.querySelectorAll("[data-dashboard-context-input]"));
  const syncContextInputs = (valueText) => {
    contextInputs.forEach((input) => {
      if (String(input.value || "") !== valueText) {
        input.value = valueText;
      }
    });
  };
  const saved = toNonNegativeInt(localStorage.getItem(DASHBOARD_CONTEXT_KEY) || "");
  if (saved !== null) {
    syncContextInputs(String(saved));
  }
  contextInputs.forEach((input) => {
    input.addEventListener("input", () => {
      const parsed = toNonNegativeInt(input.value || "");
      if (parsed === null) {
        localStorage.removeItem(DASHBOARD_CONTEXT_KEY);
        syncContextInputs("");
        return;
      }
      const next = String(parsed);
      localStorage.setItem(DASHBOARD_CONTEXT_KEY, next);
      syncContextInputs(next);
    });
  });

  document.querySelectorAll("[data-dashboard-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = String(button.getAttribute("data-dashboard-jump") || "").trim();
      if (!target) {
        return;
      }
      const tab = document.querySelector(`.tab[data-tab-target="${target}"]`);
      if (tab instanceof HTMLElement) {
        tab.click();
      }
    });
  });

  document.querySelector("#dashboard_summary_refresh")?.addEventListener("click", () => {
    Promise.allSettled([loadStatusOverview({ silent: true }), loadErrorSummary({ silent: true }), checkUpdate({ silent: true })])
      .then((results) => {
        const failed = results.filter((item) => item.status === "rejected");
        if (failed.length > 0) {
          const reasons = failed.map((item) => item.reason?.message || String(item.reason || "unknown"));
          setMessage(`仪表盘刷新部分失败：${reasons.join(" | ")}`, "error");
          return;
        }
        setMessage("仪表盘状态总览刷新完成", "ok");
      });
  });

  document.querySelector("#dashboard_quick_model_ref")?.addEventListener("change", () => {
    const settings = modelEditorState.currentModelSettings;
    const selectedRef = String(getInputValue("dashboard_quick_model_ref") || "").trim();
    const entry = findModelEntryByRef(settings, selectedRef);
    renderDashboardQuickSwitchHint(entry);
  });

  document.querySelector("#dashboard_quick_switch")?.addEventListener("click", () => {
    const settings = modelEditorState.currentModelSettings;
    if (!settings) {
      setMessage("模型配置尚未加载完成，请稍后重试", "error");
      return;
    }
    const selectedRef = String(getInputValue("dashboard_quick_model_ref") || "").trim();
    if (!selectedRef) {
      setMessage("请先选择目标模型", "error");
      return;
    }
    const entry = findModelEntryByRef(settings, selectedRef);
    if (!entry) {
      setMessage("目标模型不存在，请刷新页面后重试", "error");
      return;
    }
    switchDefaultModelByEntry(settings, entry, "已从仪表盘切换默认模型到").catch((error) =>
      setMessage(error.message || String(error), "error")
    );
  });
}

function truncateText(value, max = 72) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function updateDashboardErrorSummary(lines = []) {
  const list = Array.isArray(lines) ? lines : [];
  const latestLine = list.length > 0 ? String(list[list.length - 1] || "").trim() : "";
  dashboardSummaryState.errorCount = list.length;
  dashboardSummaryState.latestError = latestLine;

  if (list.length === 0) {
    setText("dashboard_summary_errors", "无错误");
    setText("dashboard_summary_errors_meta", "最近 20 条中未发现错误关键字");
    return;
  }

  setText("dashboard_summary_errors", `${list.length} 条错误`);
  setText("dashboard_summary_errors_meta", truncateText(latestLine, 80) || "已命中错误关键字");
}

function updateDashboardVersionSummary(updateResult = {}) {
  const currentTag = String(updateResult?.currentTag || "").trim();
  const latestTag = String(updateResult?.latestTag || "").trim();
  const warning = String(updateResult?.warning || "").trim();
  const hasUpdate = Boolean(updateResult?.updateAvailable);

  dashboardSummaryState.currentTag = currentTag;
  dashboardSummaryState.latestTag = latestTag;
  dashboardSummaryState.updateAvailable = hasUpdate;
  dashboardSummaryState.updateWarning = warning;

  if (warning) {
    setText("dashboard_summary_version", currentTag ? `当前 ${currentTag}` : "检查失败");
    setText("dashboard_summary_version_meta", truncateText(`最新版本读取失败：${warning}`, 90));
    return;
  }

  if (!currentTag && !latestTag) {
    setText("dashboard_summary_version", "未读取");
    setText("dashboard_summary_version_meta", "尚未获取版本信息");
    return;
  }

  setText("dashboard_summary_version", hasUpdate ? `可升级到 ${latestTag || "-"}` : `当前 ${currentTag || "-"}`);
  setText(
    "dashboard_summary_version_meta",
    hasUpdate ? `当前 ${currentTag || "-"}，检测到新版本` : `当前 ${currentTag || "-"}，已是最新`
  );
}

function updateDashboardSummaryCards({ runtime = {}, model = {}, channels = {}, skills = {}, refreshedAt = "" } = {}) {
  const runtimeMode = String(runtime?.mode || "-");
  const runtimeState = runtime?.active ? "运行中" : runtime?.ok === false ? "状态异常" : "未运行";
  setText("dashboard_summary_runtime", runtimeState);
  setText("dashboard_summary_runtime_meta", `模式: ${runtimeMode} | ${truncateText(runtime?.message || "-", 56)}`);

  const currentModel = model?.current && typeof model.current === "object" ? model.current : {};
  const modelId = String(currentModel?.modelName || currentModel?.modelId || "-");
  const modelProvider = String(currentModel?.providerId || "-");
  setText("dashboard_summary_model", modelId || "-");
  setText("dashboard_summary_model_meta", `提供商: ${modelProvider}`);

  const channelRuntime = channels?.runtime && typeof channels.runtime === "object" ? channels.runtime : {};
  const channelRunning = Number(channelRuntime?.running ?? 0);
  const channelTotal = Number(channelRuntime?.total ?? 0);
  setText("dashboard_summary_channels", `${channelRunning}/${channelTotal}`);
  setText(
    "dashboard_summary_channels_meta",
    channelRuntime?.ok === false
      ? `渠道状态读取失败: ${truncateText(channelRuntime?.message || "-", 56)}`
      : "运行中 / 总渠道数"
  );

  const skillSummary = skills && typeof skills === "object" ? skills : {};
  const skillEnabled = Number(skillSummary?.enabled ?? 0);
  const skillTotal = Number(skillSummary?.total ?? 0);
  setText("dashboard_summary_skills", `${skillEnabled}/${skillTotal}`);
  setText(
    "dashboard_summary_skills_meta",
    skillSummary?.ok === false ? `Skills 状态读取失败: ${truncateText(skillSummary?.message || "-", 56)}` : "已启用 / 总技能数"
  );

  const hint = document.querySelector("#dashboard_summary_hint");
  if (hint) {
    hint.textContent = refreshedAt ? `最后刷新：${refreshedAt}` : "点击“刷新总览”后显示最新状态。";
  }
}

function renderChannelRuntimeList(containerSelector, items = [], emptyText = "暂无渠道运行数据") {
  const container = document.querySelector(containerSelector);
  if (!container) {
    return;
  }
  if (!Array.isArray(items) || items.length === 0) {
    setStackListEmpty(container, emptyText);
    return;
  }

  container.innerHTML = "";
  items.forEach((item) => {
    const node = document.createElement("article");
    node.className = "stack-item";
    node.title = `${item?.name || item?.key || "未命名 Skill"}\nkey: ${item?.key || "-"}\nsource: ${item?.source || "-"}`;

    const top = document.createElement("div");
    top.className = "stack-item-row";
    const title = document.createElement("span");
    title.className = "stack-item-title";
    title.textContent = item?.label || item?.id || "未命名渠道";
    top.appendChild(title);

    const chips = document.createElement("div");
    chips.className = "chip-line";

    const configuredChip = document.createElement("span");
    configuredChip.className = "mini-chip";
    configuredChip.textContent = item?.configured ? "已配置" : "未配置";
    chips.appendChild(configuredChip);

    const runningChip = document.createElement("span");
    runningChip.className = "mini-chip";
    runningChip.textContent = item?.running ? "运行中" : "未运行";
    chips.appendChild(runningChip);

    top.appendChild(chips);
    node.appendChild(top);

    const meta = document.createElement("p");
    meta.className = "stack-item-meta";
    const errorText = String(item?.lastError || "").trim();
    const probeText = formatLocalTime(item?.lastProbeAt);
    meta.textContent = errorText ? `最近错误: ${errorText} | 最近探针: ${probeText}` : `最近探针: ${probeText}`;
    node.appendChild(meta);
    container.appendChild(node);
  });
}

function renderSkillsRuntimeList(containerSelector, items = [], emptyText = "暂无 Skills 运行数据") {
  const container = document.querySelector(containerSelector);
  if (!container) {
    return;
  }
  if (!Array.isArray(items) || items.length === 0) {
    setStackListEmpty(container, emptyText);
    return;
  }

  container.innerHTML = "";
  items.forEach((item) => {
    const node = document.createElement("article");
    node.className = "stack-item";

    const top = document.createElement("div");
    top.className = "stack-item-row";
    const title = document.createElement("span");
    title.className = "stack-item-title";
    title.textContent = item?.name || item?.key || "未命名 Skill";
    top.appendChild(title);

    const chips = document.createElement("div");
    chips.className = "chip-line";

    const enabledChip = document.createElement("span");
    enabledChip.className = "mini-chip";
    enabledChip.textContent = item?.enabled ? "已启用" : "已禁用";
    chips.appendChild(enabledChip);

    const eligibleChip = document.createElement("span");
    eligibleChip.className = "mini-chip";
    eligibleChip.textContent = item?.eligible ? "可用" : "不可用";
    chips.appendChild(eligibleChip);

    const blockedChip = document.createElement("span");
    blockedChip.className = "mini-chip";
    blockedChip.textContent = item?.blocked ? "受限" : "正常";
    chips.appendChild(blockedChip);

    top.appendChild(chips);
    node.appendChild(top);

    const meta = document.createElement("p");
    meta.className = "stack-item-meta";
    meta.textContent = `key: ${item?.key || "-"} | source: ${item?.source || "-"}`;
    node.appendChild(meta);
    container.appendChild(node);
  });
}

function renderDashboardChannelRuntime(items = []) {
  renderChannelRuntimeList("#dashboard_channel_runtime_list", items, "暂无渠道运行数据");
}

function renderDashboardSkillsRuntime(items = []) {
  renderSkillsRuntimeList("#dashboard_skills_runtime_list", items, "暂无 Skills 运行数据");
}

async function loadStatusOverview({ silent = false } = {}) {
  const response = await api("/api/dashboard/summary");
  const summary = response?.summary && typeof response.summary === "object" ? response.summary : {};
  const runtime = summary.runtime && typeof summary.runtime === "object" ? summary.runtime : {};
  const model = summary.model && typeof summary.model === "object" ? summary.model : {};
  const channels = summary.channels && typeof summary.channels === "object" ? summary.channels : {};
  const runtimeChannels = channels.runtime && typeof channels.runtime === "object" ? channels.runtime : {};
  const skills = summary.skills && typeof summary.skills === "object" ? summary.skills : {};
  const refreshedAt = new Date().toLocaleString();
  renderDashboardChannelRuntime(Array.isArray(runtimeChannels.items) ? runtimeChannels.items : []);
  renderDashboardSkillsRuntime(Array.isArray(skills.items) ? skills.items : []);
  updateDashboardSummaryCards({
    runtime,
    model,
    channels,
    skills,
    refreshedAt
  });

  if (!silent) {
    setMessage("状态总览刷新完成", "ok");
  }
}

function setSkillsSaveResult(text, mode = "") {
  const node = document.querySelector("#skills_save_result");
  if (!node) {
    return;
  }
  node.textContent = String(text || "").trim() || "请选择 Skill 后再进行写回。";
  node.classList.remove("success", "fail");
  if (mode === "success") {
    node.classList.add("success");
  } else if (mode === "fail") {
    node.classList.add("fail");
  }
}

function resetSkillEditForm() {
  setInput("skills_edit_enabled", "");
  setInput("skills_edit_api_key", "");
  setInput("skills_edit_clear_api_key", false);
  setInput("skills_edit_env_patch", "");
  const apiKeyInput = document.querySelector("#skills_edit_api_key");
  if (apiKeyInput) {
    apiKeyInput.disabled = false;
  }
}

function parseSkillEnvPatch(rawText) {
  const envPatch = {};
  const lines = String(rawText || "").split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = String(rawLine || "").trim();
    if (!line || line.startsWith("#")) {
      return;
    }
    const splitAt = line.indexOf("=");
    if (splitAt <= 0) {
      throw new Error(`环境变量补丁格式错误（第 ${index + 1} 行），请使用 KEY=VALUE`);
    }
    const key = line.slice(0, splitAt).trim();
    if (!key) {
      throw new Error(`环境变量补丁格式错误（第 ${index + 1} 行），KEY 不能为空`);
    }
    const value = line.slice(splitAt + 1).trim();
    envPatch[key] = value;
  });
  return envPatch;
}

function collectSkillConfigPatch() {
  const patch = {};
  const enabledValue = String(getInputValue("skills_edit_enabled") || "").trim();
  if (enabledValue === "true") {
    patch.enabled = true;
  } else if (enabledValue === "false") {
    patch.enabled = false;
  }

  const apiKey = String(getInputValue("skills_edit_api_key") || "").trim();
  const clearApiKey = Boolean(getInputValue("skills_edit_clear_api_key"));
  if (clearApiKey && apiKey) {
    throw new Error("已勾选“清除当前 API Key”，请不要同时填写新的 API Key");
  }
  if (apiKey) {
    patch.apiKey = apiKey;
  }
  if (clearApiKey) {
    patch.clearApiKey = true;
  }

  const envPatch = parseSkillEnvPatch(getInputValue("skills_edit_env_patch"));
  if (Object.keys(envPatch).length > 0) {
    patch.env = envPatch;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("没有可写入字段：请至少填写一项（启用状态/API Key/环境变量）");
  }
  return patch;
}

async function saveSkillConfigPatch() {
  const skillKey = String(skillsPageState.selectedSkillKey || "").trim();
  if (!skillKey) {
    throw new Error("请先在上方列表选择一个 Skill");
  }
  const patch = collectSkillConfigPatch();
  setSkillsSaveResult("正在写入 Skill 配置...", "");
  const response = await api(`/api/skills/${encodeURIComponent(skillKey)}/config`, {
    method: "PUT",
    body: JSON.stringify(patch)
  });
  const result = response?.result && typeof response.result === "object" ? response.result : {};
  setSkillsSaveResult(`写入成功：${skillKey}（备份：${result.backupPath || "无"}）`, "success");
  setMessage(`Skill 配置写入成功：${skillKey}`, "ok");
  resetSkillEditForm();
  await loadSkillsStatus({ silent: true, preserveSelection: false, selectedSkillKey: skillKey });
  await loadSkillConfig(skillKey, { silent: true });
}

function renderSkillsList(skills = []) {
  const container = document.querySelector("#skills_list");
  if (!container) {
    return;
  }
  if (!Array.isArray(skills) || skills.length === 0) {
    setStackListEmpty(container, "当前没有可管理的 Skills");
    return;
  }

  container.innerHTML = "";
  skills.forEach((skill) => {
    const node = document.createElement("article");
    const isSelected = String(skill?.key || "") === skillsPageState.selectedSkillKey;
    node.className = `stack-item${isSelected ? " is-selected" : ""}`;

    const top = document.createElement("div");
    top.className = "stack-item-row";
    const title = document.createElement("span");
    title.className = "stack-item-title";
    title.textContent = skill?.name || skill?.key || "未命名 Skill";
    top.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "actions";

    const configBtn = document.createElement("button");
    configBtn.type = "button";
    configBtn.className = "btn-soft";
    configBtn.textContent = "查看配置";
    configBtn.addEventListener("click", () => {
      loadSkillConfig(String(skill?.key || "")).catch((error) => setMessage(error.message || String(error), "error"));
    });
    actions.appendChild(configBtn);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = skill?.enabled ? "禁用" : "启用";
    toggleBtn.addEventListener("click", () => {
      const nextEnabled = !Boolean(skill?.enabled);
      if (!confirmSkillToggle(skill, nextEnabled)) {
        setMessage(`已取消 Skill 操作：${skill?.name || skill?.key || "未命名 Skill"}`, "info");
        return;
      }
      setSkillEnabled(String(skill?.key || ""), nextEnabled).catch((error) =>
        setMessage(error.message || String(error), "error")
      );
    });
    actions.appendChild(toggleBtn);

    top.appendChild(actions);
    node.appendChild(top);

    const meta = document.createElement("p");
    meta.className = "stack-item-meta";
    meta.textContent = `key: ${skill?.key || "-"} | source: ${skill?.source || "-"} | bundled: ${
      skill?.bundled ? "是" : "否"
    } | 最近更新: ${skill?.updatedAt || "无"}`;
    node.appendChild(meta);

    const description = document.createElement("p");
    description.className = "stack-item-meta";
    description.textContent = `说明：${skill?.description || "无"}`;
    node.appendChild(description);

    const chips = document.createElement("div");
    chips.className = "chip-line";
    [
      skill?.enabled ? "已启用" : "已禁用",
      skill?.eligible ? "可用" : "不可用",
      skill?.blocked ? "受白名单限制" : "无白名单阻塞"
    ].forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "mini-chip";
      chip.textContent = text;
      chips.appendChild(chip);
    });
    node.appendChild(chips);
    container.appendChild(node);
  });
}

function confirmSkillToggle(skill, nextEnabled) {
  const skillName = skill?.name || skill?.key || "未命名 Skill";
  if (!nextEnabled) {
    return window.confirm(`你正在禁用 Skill「${skillName}」。\n这可能影响已有工作流，确认继续吗？`);
  }
  if (skill?.blocked || !skill?.eligible) {
    return window.confirm(
      `Skill「${skillName}」当前存在运行限制（${skill?.blocked ? "白名单阻塞" : "环境未满足"}）。\n继续启用配置吗？`
    );
  }
  return true;
}

async function loadSkillConfig(skillKey, { silent = false } = {}) {
  const normalizedSkillKey = String(skillKey || "").trim();
  if (!normalizedSkillKey) {
    throw new Error("skillKey 不能为空");
  }
  const response = await api(`/api/skills/${encodeURIComponent(normalizedSkillKey)}/config`);
  skillsPageState.selectedSkillConfig = response?.result || null;
  const preview = document.querySelector("#skills_config_preview");
  if (preview) {
    preview.textContent = JSON.stringify(response?.result || {}, null, 2);
  }
  skillsPageState.selectedSkillKey = normalizedSkillKey;
  resetSkillEditForm();
  setSkillsSaveResult(`已选择 Skill：${normalizedSkillKey}。按需填写补丁后再保存。`, "");
  renderSkillsList(skillsPageState.skills);
  if (!silent) {
    setMessage(`已加载 Skill 配置：${normalizedSkillKey}`, "ok");
  }
}

async function setSkillEnabled(skillKey, enabled) {
  const normalizedSkillKey = String(skillKey || "").trim();
  if (!normalizedSkillKey) {
    throw new Error("skillKey 不能为空");
  }
  await api(`/api/skills/${encodeURIComponent(normalizedSkillKey)}/enabled`, {
    method: "POST",
    body: JSON.stringify({
      enabled: Boolean(enabled)
    })
  });
  setMessage(`${Boolean(enabled) ? "启用" : "禁用"} Skill 成功：${normalizedSkillKey}`, "ok");
  await loadSkillsStatus({ silent: true, preserveSelection: false, selectedSkillKey: normalizedSkillKey });
  await loadSkillConfig(normalizedSkillKey, { silent: true });
}

async function loadSkillsStatus({ silent = false, preserveSelection = true, selectedSkillKey = "" } = {}) {
  const response = await api("/api/skills/status");
  const result = response?.result && typeof response.result === "object" ? response.result : {};
  const skills = Array.isArray(result.skills) ? result.skills : [];

  skillsPageState.skills = skills;
  setInput("skills_total", String(result.total ?? skills.length));
  setInput("skills_enabled", String(result.enabled ?? skills.filter((item) => item?.enabled).length));
  setInput("skills_disabled", String(result.disabled ?? skills.filter((item) => !item?.enabled).length));

  const targetSkillKeyFromParam = String(selectedSkillKey || "").trim();
  const targetSkillKeyFromState = String(skillsPageState.selectedSkillKey || "").trim();
  let nextSelected = "";
  if (targetSkillKeyFromParam && skills.some((item) => item?.key === targetSkillKeyFromParam)) {
    nextSelected = targetSkillKeyFromParam;
  } else if (preserveSelection && targetSkillKeyFromState && skills.some((item) => item?.key === targetSkillKeyFromState)) {
    nextSelected = targetSkillKeyFromState;
  } else if (skills.length > 0) {
    nextSelected = String(skills[0]?.key || "").trim();
  }
  skillsPageState.selectedSkillKey = nextSelected;

  renderSkillsList(skills);
  if (nextSelected) {
    await loadSkillConfig(nextSelected, { silent: true });
  } else {
    skillsPageState.selectedSkillConfig = null;
    const preview = document.querySelector("#skills_config_preview");
    if (preview) {
      preview.textContent = "当前没有可查看的 Skill 配置";
    }
    setSkillsSaveResult("当前没有可管理的 Skill，无法写回配置。", "fail");
    resetSkillEditForm();
  }
  if (!silent) {
    setMessage(`Skills 列表刷新完成，共 ${skills.length} 项`, "ok");
  }
}

function setupSkillsPage() {
  if (skillsPageState.bound) {
    return;
  }
  skillsPageState.bound = true;
  const refreshBtn = document.querySelector("#skills_refresh");
  const saveBtn = document.querySelector("#skills_save_config");
  const clearApiKeyInput = document.querySelector("#skills_edit_clear_api_key");
  const apiKeyInput = document.querySelector("#skills_edit_api_key");

  clearApiKeyInput?.addEventListener("change", () => {
    const shouldClear = Boolean(clearApiKeyInput.checked);
    if (shouldClear && apiKeyInput) {
      apiKeyInput.value = "";
    }
    if (apiKeyInput) {
      apiKeyInput.disabled = shouldClear;
    }
  });

  refreshBtn?.addEventListener("click", () => {
    loadSkillsStatus().catch((error) => setMessage(error.message || String(error), "error"));
  });

  saveBtn?.addEventListener("click", () => {
    saveSkillConfigPatch().catch((error) => {
      const message = error?.message || String(error);
      setSkillsSaveResult(`写入失败：${message}`, "fail");
      setMessage(message, "error");
    });
  });

  setSkillsSaveResult("请选择 Skill 后再进行写回。", "");
}

function setChatStreamStatus(text) {
  setInput("chat_stream_status", text || "");
}

function setChatComposerSending(sending) {
  chatConsoleState.sending = Boolean(sending);
  const sendButton = document.querySelector("#chat_send_message");
  const abortButton = document.querySelector("#chat_abort_run");
  if (sendButton) {
    sendButton.disabled = chatConsoleState.sending;
    sendButton.textContent = chatConsoleState.sending ? "发送中..." : "发送消息";
  }
  if (abortButton) {
    abortButton.disabled = !chatConsoleState.sending;
  }
}

function setChatAttachmentHint(text) {
  const hint = document.querySelector("#chat_attachment_hint");
  if (!hint) {
    return;
  }
  hint.textContent = String(text || "").trim() || "支持点击上传、粘贴或拖拽文件（图片会显示预览）";
}

function setChatInlineHint(text, type = "") {
  const hint = document.querySelector("#chat_inline_hint");
  if (!hint) {
    return;
  }
  hint.textContent = String(text || "").trim();
  hint.classList.remove("error", "ok");
  if (type === "error") {
    hint.classList.add("error");
  } else if (type === "ok") {
    hint.classList.add("ok");
  }
}

function reportChatActionError(error, fallback = "操作失败") {
  const message = String(error?.message || error || "").trim() || fallback;
  setChatInlineHint(message, "error");
  setMessage(message, "error");
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "-";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function renderChatAttachments() {
  const container = document.querySelector("#chat_attachment_list");
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const items = Array.isArray(chatConsoleState.attachments) ? chatConsoleState.attachments : [];
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "当前没有附件";
    container.appendChild(empty);
    return;
  }

  items.forEach((item, index) => {
    const node = document.createElement("div");
    node.className = "chat-attachment-item";

    const row = document.createElement("div");
    row.className = "chat-attachment-row";

    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "chat-attachment-name";
    name.textContent = String(item.fileName || "file");
    const meta = document.createElement("div");
    meta.className = "chat-attachment-meta";
    meta.textContent = `${String(item.mimeType || "application/octet-stream")} | ${formatFileSize(item.fileSize)}`;
    info.appendChild(name);
    info.appendChild(meta);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-soft";
    removeBtn.dataset.attachmentIndex = String(index);
    removeBtn.textContent = "移除";

    row.appendChild(info);
    row.appendChild(removeBtn);
    node.appendChild(row);

    if (item.preview && String(item.mimeType || "").startsWith("image/")) {
      const image = document.createElement("img");
      image.className = "chat-attachment-preview";
      image.src = item.preview;
      image.alt = String(item.fileName || "image");
      node.appendChild(image);
    }
    container.appendChild(node);
  });
}

function removeChatAttachmentByIndex(index) {
  if (!Array.isArray(chatConsoleState.attachments)) {
    return;
  }
  if (!Number.isInteger(index) || index < 0 || index >= chatConsoleState.attachments.length) {
    return;
  }
  chatConsoleState.attachments.splice(index, 1);
  renderChatAttachments();
  setChatAttachmentHint(`已移除附件，当前 ${chatConsoleState.attachments.length} 个`);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      const match = raw.match(/^data:[^;]+;base64,(.+)$/i);
      resolve(match ? match[1] : raw);
    };
    reader.onerror = () => {
      reject(new Error(`读取文件失败：${file?.name || "unknown"}`));
    };
    reader.readAsDataURL(file);
  });
}

async function stageChatFile(file) {
  const fileName = String(file?.name || "").trim() || "file";
  const mimeType = String(file?.type || "").trim() || "application/octet-stream";
  const base64 = await fileToBase64(file);
  const response = await api("/api/chat/attachments/stage", {
    method: "POST",
    body: JSON.stringify({
      fileName,
      mimeType,
      base64
    })
  });
  return response?.result && typeof response.result === "object" ? response.result : null;
}

async function stageChatFiles(files) {
  const list = Array.from(files || []).filter(Boolean);
  if (list.length === 0) {
    return;
  }
  if (chatConsoleState.staging) {
    setChatAttachmentHint("附件还在处理中，请稍候再操作");
    return;
  }
  chatConsoleState.staging = true;
  setChatAttachmentHint(`正在处理附件（${list.length} 个）...`);
  try {
    for (const file of list) {
      const staged = await stageChatFile(file);
      if (!staged) {
        continue;
      }
      const stagedPath = String(staged.stagedPath || "").trim();
      if (!stagedPath) {
        continue;
      }
      const existedIndex = chatConsoleState.attachments.findIndex((item) => item.stagedPath === stagedPath);
      if (existedIndex >= 0) {
        chatConsoleState.attachments[existedIndex] = staged;
      } else {
        chatConsoleState.attachments.push(staged);
      }
    }
    renderChatAttachments();
    setChatAttachmentHint(`附件已就绪：${chatConsoleState.attachments.length} 个`);
  } finally {
    chatConsoleState.staging = false;
  }
}

function renderChatStreamLines() {
  const output = document.querySelector("#chat_stream_output");
  if (!output) {
    return;
  }
  output.textContent = chatConsoleState.streamLines.length > 0 ? chatConsoleState.streamLines.join("\n") : "等待流式事件...";
}

function pushChatStreamLine(text) {
  const line = `[${new Date().toLocaleTimeString()}] ${text}`;
  chatConsoleState.streamLines.push(line);
  if (chatConsoleState.streamLines.length > 300) {
    chatConsoleState.streamLines = chatConsoleState.streamLines.slice(-300);
  }
  renderChatStreamLines();
}

function resetChatStreamOutput() {
  chatConsoleState.streamLines = [];
  chatConsoleState.streamDeltasByRunId = {};
  chatConsoleState.streamThinkingByRunId = {};
  renderChatStreamLines();
  renderChatMessageList();
}

function closeChatStreamSource() {
  if (chatConsoleState.streamSource) {
    chatConsoleState.streamSource.close();
    chatConsoleState.streamSource = null;
  }
  chatConsoleState.streamSessionKey = "";
}

function extractStreamTextFromMessage(message) {
  if (!message || typeof message !== "object") {
    return "";
  }
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      return typeof part.text === "string" ? part.text : "";
    })
    .join("");
}

function normalizeChatContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (!entry || typeof entry !== "object") {
          return "";
        }
        if (entry.type === "toolCall" || entry.type === "tool_call") {
          const toolName = String(entry.name || entry.tool || "unknown");
          const args =
            typeof entry.arguments === "string"
              ? entry.arguments
              : JSON.stringify(entry.arguments ?? entry.partialJson ?? {}, null, 2);
          return `[工具调用] ${toolName}\n参数:\n${args}`;
        }
        if (entry.type === "toolResult" || entry.type === "tool_result") {
          const resultText =
            typeof entry.text === "string"
              ? entry.text
              : JSON.stringify(entry.details ?? entry.result ?? entry, null, 2);
          return `[工具结果]\n${resultText}`;
        }
        if (typeof entry.text === "string") {
          return entry.text;
        }
        if (typeof entry.content === "string") {
          return entry.content;
        }
        return JSON.stringify(entry);
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") {
      return content.text;
    }
    return JSON.stringify(content);
  }
  return String(content ?? "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRichTextSegment(segment) {
  let html = escapeHtml(segment);
  html = html.replace(/\*\*([^\n*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/\n/g, "<br>");
  return `<span>${html}</span>`;
}

function renderRichMessageBody(text) {
  const source = String(text || "");
  if (!source) {
    return "<span>(空消息)</span>";
  }
  const parts = source.split("```");
  return parts
    .map((part, index) => {
      if (index % 2 === 0) {
        return renderRichTextSegment(part);
      }
      const firstBreak = part.indexOf("\n");
      let codeLang = "";
      let codeBody = part;
      if (firstBreak >= 0) {
        codeLang = part.slice(0, firstBreak).trim();
        codeBody = part.slice(firstBreak + 1);
      }
      const langAttr = codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : "";
      return `<pre class="chat-code"><code${langAttr}>${escapeHtml(codeBody)}</code></pre>`;
    })
    .join("");
}

function formatChatRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "user") {
    return "你";
  }
  if (normalized === "assistant") {
    return "助手";
  }
  if (normalized === "system") {
    return "系统";
  }
  if (
    normalized === "tool" ||
    normalized === "tool_use" ||
    normalized === "tool_result" ||
    normalized === "toolresult" ||
    normalized === "toolcall"
  ) {
    return "工具";
  }
  return normalized || "未知";
}

function normalizeChatMessage(message = {}, index = 0) {
  const role = String(message?.role || message?.author || message?.type || "assistant").trim().toLowerCase() || "assistant";
  const status = String(message?.status || "").trim();
  const thinking = String(
    message?.thinkingState || message?.thinking || message?.reasoning || message?.reasoningEffort || ""
  ).trim();
  const body = normalizeChatContent(
    message?.content ?? message?.parts ?? message?.message ?? message?.delta ?? message?.text ?? ""
  );
  const attachments = Array.isArray(message?._attachedFiles)
    ? message._attachedFiles
        .map((entry) => ({
          fileName: String(entry?.fileName || "").trim(),
          mimeType: String(entry?.mimeType || "").trim() || "application/octet-stream",
          fileSize: Number(entry?.fileSize || 0) || 0,
          preview: String(entry?.preview || "").trim() || ""
        }))
        .filter((entry) => entry.fileName)
    : [];
  return {
    id: `history-${index + 1}`,
    role,
    status,
    thinking,
    body: body || "(空消息)",
    timestamp: message?.timestamp || message?.createdAt || message?.at || "",
    attachments
  };
}

function createChatMessageNode(item, { streaming = false, showThinking = true } = {}) {
  const node = document.createElement("div");
  const role = String(item?.role || "assistant").toLowerCase();
  node.className = `chat-message ${role === "user" ? "user" : "assistant"}${streaming ? " streaming" : ""}`;

  const header = document.createElement("div");
  header.className = "chat-message-header";

  const roleEl = document.createElement("span");
  roleEl.className = "chat-role";
  roleEl.textContent = formatChatRole(role);
  header.appendChild(roleEl);

  const metaEl = document.createElement("span");
  metaEl.textContent = streaming ? "实时生成中..." : String(item?.status || "").trim() || "";
  header.appendChild(metaEl);

  node.appendChild(header);

  if (showThinking && String(item?.thinking || "").trim()) {
    const thinkingEl = document.createElement("span");
    thinkingEl.className = "chat-thinking";
    thinkingEl.textContent = `思考：${item.thinking}`;
    node.appendChild(thinkingEl);
  }

  const body = document.createElement("div");
  body.className = "chat-message-body";
  const bodyText = String(item?.body || "").trim() || "(空消息)";
  const shouldRenderRich =
    role === "assistant" || role === "system" || role === "tool" || role === "toolresult" || role === "toolcall";
  if (shouldRenderRich) {
    body.innerHTML = renderRichMessageBody(bodyText);
  } else {
    body.textContent = bodyText;
  }
  node.appendChild(body);

  const files = Array.isArray(item?.attachments) ? item.attachments : [];
  if (files.length > 0) {
    const fileList = document.createElement("div");
    fileList.className = "chip-line";
    files.forEach((entry) => {
      const chip = document.createElement("span");
      chip.className = "mini-chip";
      chip.textContent = `${String(entry?.fileName || "file")} (${formatFileSize(entry?.fileSize)})`;
      fileList.appendChild(chip);
    });
    node.appendChild(fileList);
  }
  return node;
}

function renderChatMessageList() {
  const container = document.querySelector("#chat_messages");
  if (!container) {
    return;
  }
  const showThinking = Boolean(getInputValue("chat_show_thinking"));
  container.innerHTML = "";

  const items = Array.isArray(chatConsoleState.historyMessages) ? chatConsoleState.historyMessages : [];
  items.forEach((item) => {
    container.appendChild(createChatMessageNode(item, { showThinking }));
  });

  Object.entries(chatConsoleState.streamDeltasByRunId).forEach(([runId, text]) => {
    const thinking = String(chatConsoleState.streamThinkingByRunId[runId] || "").trim();
    container.appendChild(
      createChatMessageNode(
        {
          role: "assistant",
          status: runId ? `runId: ${runId}` : "",
          thinking,
          body: String(text || "").trim() || "正在生成..."
        },
        { streaming: true, showThinking }
      )
    );
  });

  if (container.childElementCount === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "请选择会话后开始对话";
    container.appendChild(empty);
  }

  container.scrollTop = container.scrollHeight;
}

function renderChatHistory(history = {}) {
  const output = document.querySelector("#chat_history_output");
  if (!output) {
    return;
  }
  const sessionKey = String(history.sessionKey || chatConsoleState.selectedSessionKey || "").trim();
  const sessionId = String(history.sessionId || "").trim();
  const thinkingLevel = String(history.thinkingLevel || "").trim();
  const verboseLevel = String(history.verboseLevel || "").trim();
  const messages = Array.isArray(history.messages) ? history.messages : [];

  const lines = [];
  lines.push(`sessionKey: ${sessionKey || "-"}`);
  lines.push(`sessionId: ${sessionId || "-"}`);
  lines.push(`thinkingLevel: ${thinkingLevel || "-"}`);
  lines.push(`verboseLevel: ${verboseLevel || "-"}`);
  lines.push(`messages: ${messages.length}`);

  chatConsoleState.historyMessages = messages.map((message, index) => normalizeChatMessage(message, index));
  renderChatMessageList();

  messages.forEach((message, index) => {
    const role = String(message?.role || message?.author || message?.type || "unknown").trim() || "unknown";
    const status = String(message?.status || "").trim();
    const thinkingState = String(
      message?.thinkingState || message?.thinking || message?.reasoning || message?.reasoningEffort || ""
    ).trim();
    const content = normalizeChatContent(
      message?.content ?? message?.parts ?? message?.message ?? message?.delta ?? message?.text ?? ""
    );

    lines.push("");
    lines.push(`#${index + 1} ${role}${status ? ` [${status}]` : ""}`);
    if (thinkingState) {
      lines.push(`思考状态: ${thinkingState}`);
    }
    lines.push(content || "(empty)");
  });

  output.textContent = lines.join("\n");
}

function handleChatStreamEvent(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const state = String(data.state || "").trim();
  const runId = String(data.runId || "").trim();
  const sessionKey = String(data.sessionKey || "").trim();
  if (runId) {
    chatConsoleState.lastRunId = runId;
    setInput("chat_last_run_id", runId);
  }

  const deltaChunk = extractStreamTextFromMessage(data.message);
  if (state === "delta") {
    if (runId) {
      const previous = String(chatConsoleState.streamDeltasByRunId[runId] || "");
      chatConsoleState.streamDeltasByRunId[runId] = previous + deltaChunk;
    }
    pushChatStreamLine(`[chat:${state}] ${runId || "-"} ${deltaChunk || "(empty-delta)"}`);
    renderChatMessageList();
    return;
  }

  if (state === "final") {
    const mergedText = runId ? String(chatConsoleState.streamDeltasByRunId[runId] || "") : "";
    const finalChunk = deltaChunk || mergedText || "(empty)";
    pushChatStreamLine(`[chat:final] ${runId || "-"} ${finalChunk}`);
    if (runId) {
      delete chatConsoleState.streamDeltasByRunId[runId];
      delete chatConsoleState.streamThinkingByRunId[runId];
    }
    setChatComposerSending(false);
    renderChatMessageList();
    if (sessionKey) {
      loadChatHistory({ sessionKey, silent: true }).catch(() => {});
    }
    return;
  }

  if (state === "aborted" || state === "error") {
    const reason = String(data.stopReason || data.errorMessage || "").trim();
    pushChatStreamLine(`[chat:${state}] ${runId || "-"} ${reason || "-"}`);
    if (runId) {
      delete chatConsoleState.streamDeltasByRunId[runId];
      delete chatConsoleState.streamThinkingByRunId[runId];
    }
    setChatComposerSending(false);
    renderChatMessageList();
    if (sessionKey) {
      loadChatHistory({ sessionKey, silent: true }).catch(() => {});
    }
    return;
  }

  pushChatStreamLine(`[chat:${state || "unknown"}] ${runId || "-"} seq=${data.seq ?? "-"}`);
}

function handleAgentStreamEvent(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const stream = String(data.stream || "").trim() || "-";
  const phase = String(data.phase || "").trim() || "-";
  const runId = String(data.runId || "").trim() || "-";
  pushChatStreamLine(`[agent:${stream}] ${runId} phase=${phase}`);
  if (runId !== "-") {
    chatConsoleState.streamThinkingByRunId[runId] = phase;
    renderChatMessageList();
  }
}

function connectChatStream(sessionKey, { silent = false, force = false } = {}) {
  const normalizedSessionKey = String(sessionKey || chatConsoleState.selectedSessionKey || "").trim();
  if (!normalizedSessionKey) {
    setChatStreamStatus("未连接（未选择会话）");
    return;
  }
  if (!force && chatConsoleState.streamSource && chatConsoleState.streamSessionKey === normalizedSessionKey) {
    return;
  }

  closeChatStreamSource();
  chatConsoleState.streamSessionKey = normalizedSessionKey;
  resetChatStreamOutput();
  setChatStreamStatus(`连接中 (${normalizedSessionKey})`);
  if (!silent) {
    setMessage(`实时通道连接中：${normalizedSessionKey}`, "info");
  }

  const query = new URLSearchParams({
    sessionKey: normalizedSessionKey,
    includeAgent: "true"
  });
  const source = new EventSource(`/api/chat/stream?${query.toString()}`);
  chatConsoleState.streamSource = source;

  source.addEventListener("ready", (event) => {
    try {
      const payload = JSON.parse(event.data || "{}");
      setChatStreamStatus(`已建立 (${payload.sessionKey || normalizedSessionKey})`);
      pushChatStreamLine(`[stream:ready] session=${payload.sessionKey || normalizedSessionKey}`);
    } catch {
      setChatStreamStatus("已建立");
    }
  });

  source.addEventListener("status", (event) => {
    try {
      const payload = JSON.parse(event.data || "{}");
      const state = String(payload.state || "").trim();
      if (state === "connected") {
        setChatStreamStatus(`已连接 (${payload.sessionKey || normalizedSessionKey})`);
      } else if (state === "reconnecting") {
        setChatStreamStatus(`重连中（第${payload.attempt || 1}次）`);
      } else if (state === "connect-failed") {
        setChatStreamStatus("连接失败，自动重试中");
      } else if (state === "gateway-closed") {
        setChatStreamStatus("网关断开，自动重连中");
      } else {
        setChatStreamStatus(state || "状态更新");
      }
      pushChatStreamLine(`[stream:${state || "status"}] ${payload.reason || payload.message || ""}`.trim());
    } catch {
      setChatStreamStatus("状态更新");
    }
  });

  source.addEventListener("chat", (event) => {
    try {
      handleChatStreamEvent(JSON.parse(event.data || "{}"));
    } catch (error) {
      pushChatStreamLine(`[stream:parse-error] ${error.message || String(error)}`);
    }
  });

  source.addEventListener("agent", (event) => {
    try {
      handleAgentStreamEvent(JSON.parse(event.data || "{}"));
    } catch (error) {
      pushChatStreamLine(`[stream:parse-error] ${error.message || String(error)}`);
    }
  });

  source.addEventListener("stream-error", (event) => {
    try {
      const payload = JSON.parse(event.data || "{}");
      pushChatStreamLine(`[stream:error] ${payload.message || "unknown error"}`);
      setChatComposerSending(false);
    } catch {
      pushChatStreamLine("[stream:error] unknown error");
      setChatComposerSending(false);
    }
  });

  source.addEventListener("error", () => {
    setChatStreamStatus("连接波动，浏览器重连中");
  });
}

function renderChatSessionSelect() {
  const select = document.querySelector("#chat_session_select");
  if (!select) {
    return;
  }
  const sessions = Array.isArray(chatConsoleState.sessions) ? chatConsoleState.sessions : [];
  select.innerHTML = "";
  if (sessions.length === 0) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "暂无会话";
    select.appendChild(emptyOption);
    select.value = "";
    return;
  }

  sessions.forEach((session) => {
    const option = document.createElement("option");
    option.value = session?.key || "";
    const ctx = Number(session?.contextTokens || 0);
    const model = String(session?.model || "-");
    const name = String(session?.displayName || session?.key || "未命名会话");
    option.textContent = `${name} | ${model} | ctx ${ctx > 0 ? ctx.toLocaleString() : "-"}`;
    select.appendChild(option);
  });

  if (chatConsoleState.selectedSessionKey && sessions.some((item) => item?.key === chatConsoleState.selectedSessionKey)) {
    select.value = chatConsoleState.selectedSessionKey;
  } else {
    select.selectedIndex = 0;
    chatConsoleState.selectedSessionKey = String(select.value || "").trim();
  }
}

async function loadChatSessions({ silent = false, preserveSelection = true, selectedSessionKey = "" } = {}) {
  const response = await api("/api/chat/sessions");
  const result = response?.result && typeof response.result === "object" ? response.result : {};
  const sessions = Array.isArray(result.sessions) ? result.sessions : [];
  const previous = String(chatConsoleState.selectedSessionKey || "").trim();
  const requested = String(selectedSessionKey || "").trim();
  chatConsoleState.sessions = sessions;

  if (requested && sessions.some((item) => item?.key === requested)) {
    chatConsoleState.selectedSessionKey = requested;
  } else if (preserveSelection && previous && sessions.some((item) => item?.key === previous)) {
    chatConsoleState.selectedSessionKey = previous;
  } else {
    chatConsoleState.selectedSessionKey = String(sessions[0]?.key || "").trim();
  }

  chatConsoleState.attachments = [];
  renderChatAttachments();
  setChatAttachmentHint("支持点击上传、粘贴或拖拽文件（图片会显示预览）");

  renderChatSessionSelect();
  if (chatConsoleState.selectedSessionKey) {
    connectChatStream(chatConsoleState.selectedSessionKey, { silent: true });
    await loadChatHistory({
      sessionKey: chatConsoleState.selectedSessionKey,
      silent: true
    });
  } else {
    closeChatStreamSource();
    setChatStreamStatus("未连接（暂无会话）");
    chatConsoleState.historyMessages = [];
    renderChatMessageList();
    setChatComposerSending(false);
    const output = document.querySelector("#chat_history_output");
    if (output) {
      output.textContent = "暂无会话可展示";
    }
  }
  if (!silent) {
    setMessage(`会话列表刷新完成，共 ${sessions.length} 条`, "ok");
  }
  if (silent) {
    setChatInlineHint("");
  }
}

async function loadChatHistory({ sessionKey = "", silent = false } = {}) {
  const normalizedSessionKey = String(sessionKey || chatConsoleState.selectedSessionKey || "").trim();
  if (!normalizedSessionKey) {
    throw new Error("请先选择会话");
  }
  chatConsoleState.selectedSessionKey = normalizedSessionKey;
  const query = new URLSearchParams({
    sessionKey: normalizedSessionKey,
    limit: "200"
  });
  const response = await api(`/api/chat/history?${query.toString()}`);
  const result = response?.result && typeof response.result === "object" ? response.result : {};
  renderChatHistory({
    ...result,
    sessionKey: normalizedSessionKey
  });
  if (!silent) {
    setMessage(`会话历史刷新完成：${normalizedSessionKey}`, "ok");
  }
}

async function createChatSession() {
  const response = await api("/api/chat/session/new", {
    method: "POST",
    body: JSON.stringify({})
  });
  const result = response?.result && typeof response.result === "object" ? response.result : {};
  const sessionKey = String(result.key || "").trim();
  if (!sessionKey) {
    throw new Error("新建会话失败：未返回会话 key");
  }
  await loadChatSessions({
    silent: true,
    preserveSelection: false,
    selectedSessionKey: sessionKey
  });
  setChatInlineHint("新会话创建成功", "ok");
  setMessage(`已创建新会话：${sessionKey}`, "ok");
}

async function sendChatConsoleMessage() {
  const sessionKey = String(getInputValue("chat_session_select") || chatConsoleState.selectedSessionKey || "").trim();
  const message = String(getInputValue("chat_message_input") || "").trim();
  const attachments = Array.isArray(chatConsoleState.attachments) ? [...chatConsoleState.attachments] : [];
  if (!sessionKey) {
    throw new Error("请先选择会话");
  }
  if (!message && attachments.length === 0) {
    throw new Error("请输入消息或添加至少一个附件");
  }
  if (chatConsoleState.sending) {
    throw new Error("当前正在生成回复，请稍候或先点击“停止回复”");
  }
  if (chatConsoleState.staging) {
    throw new Error("附件仍在处理中，请稍候再发送");
  }

  const payload = {
    sessionKey,
    message,
    thinking: String(getInputValue("chat_thinking_level") || "").trim(),
    idempotencyKey: String(getInputValue("chat_idempotency_key") || "").trim(),
    attachments: attachments.map((item) => ({
      fileName: String(item?.fileName || "").trim() || "file",
      mimeType: String(item?.mimeType || "").trim() || "application/octet-stream",
      fileSize: Number(item?.fileSize || 0) || 0,
      stagedPath: String(item?.stagedPath || "").trim(),
      preview: String(item?.preview || "").trim() || ""
    }))
  };
  if (payload.attachments.some((item) => !item.stagedPath)) {
    throw new Error("存在未完成的附件，请重新添加后再发送");
  }

  const optimisticMessage = {
    id: `local-user-${Date.now()}`,
    role: "user",
    status: payload.attachments.length > 0 ? `附件 ${payload.attachments.length} 个` : "",
    thinking: "",
    body: message || "(仅附件)",
    attachments: payload.attachments
      .map((item) => ({
        fileName: item.fileName,
        mimeType: item.mimeType,
        fileSize: item.fileSize,
        preview: item.preview
      }))
      .filter((item) => item.fileName)
  };
  chatConsoleState.historyMessages.push(optimisticMessage);
  chatConsoleState.attachments = [];
  renderChatAttachments();
  setChatAttachmentHint("支持点击上传、粘贴或拖拽文件（图片会显示预览）");
  setInput("chat_message_input", "");
  setInput("chat_file_input", "");

  chatConsoleState.streamDeltasByRunId = {};
  chatConsoleState.streamThinkingByRunId = {};
  renderChatMessageList();

  setChatComposerSending(true);
  connectChatStream(sessionKey, { silent: true });
  try {
    const response = await api("/api/chat/send", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const result = response?.result && typeof response.result === "object" ? response.result : {};
    chatConsoleState.lastRunId = String(result.runId || "").trim();
    setInput("chat_last_run_id", chatConsoleState.lastRunId);
    if (!chatConsoleState.lastRunId) {
      setChatComposerSending(false);
    }
    setMessage(
      payload.attachments.length > 0
        ? `消息和附件已发送（status=${result.status || "unknown"}，附件=${payload.attachments.length}）`
        : `消息已发送（status=${result.status || "unknown"}）`,
      "ok"
    );
    setChatInlineHint("消息已发送，正在等待回复...", "ok");
  } catch (error) {
    setChatComposerSending(false);
    chatConsoleState.historyMessages = chatConsoleState.historyMessages.filter((item) => item.id !== optimisticMessage.id);
    chatConsoleState.attachments = attachments;
    renderChatAttachments();
    renderChatMessageList();
    throw error;
  }
}

function setupChatAttachmentInput() {
  const fileInput = document.querySelector("#chat_file_input");
  const pickBtn = document.querySelector("#chat_pick_files");
  const attachmentList = document.querySelector("#chat_attachment_list");
  const messageInput = document.querySelector("#chat_message_input");

  pickBtn?.addEventListener("click", () => {
    fileInput?.click();
  });

  fileInput?.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) {
      return;
    }
    stageChatFiles(files).catch((error) => reportChatActionError(error, "附件处理失败"));
    fileInput.value = "";
  });

  attachmentList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const idx = Number.parseInt(String(target.dataset.attachmentIndex || ""), 10);
    if (Number.isInteger(idx)) {
      removeChatAttachmentByIndex(idx);
    }
  });

  const dragTargets = [messageInput, attachmentList].filter(Boolean);
  dragTargets.forEach((node) => {
    node.addEventListener("dragover", (event) => {
      event.preventDefault();
      attachmentList?.classList.add("is-dragover");
    });
    node.addEventListener("dragleave", () => {
      attachmentList?.classList.remove("is-dragover");
    });
    node.addEventListener("drop", (event) => {
      event.preventDefault();
      attachmentList?.classList.remove("is-dragover");
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length > 0) {
        stageChatFiles(files).catch((error) => reportChatActionError(error, "附件处理失败"));
      }
    });
  });

  messageInput?.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    stageChatFiles(files).catch((error) => reportChatActionError(error, "附件处理失败"));
  });
}

async function abortChatConsoleRun() {
  const sessionKey = String(getInputValue("chat_session_select") || chatConsoleState.selectedSessionKey || "").trim();
  if (!sessionKey) {
    throw new Error("请先选择会话");
  }
  const runId = String(getInputValue("chat_last_run_id") || "").trim();
  const response = await api("/api/chat/abort", {
    method: "POST",
    body: JSON.stringify({
      sessionKey,
      runId
    })
  });
  const result = response?.result && typeof response.result === "object" ? response.result : {};
  const runIds = Array.isArray(result.runIds) ? result.runIds : [];
  setChatComposerSending(false);
  setMessage(
    result.aborted ? `已发送中止请求，runIds=${runIds.join(",") || "-"}` : "当前没有可中止的运行任务",
    result.aborted ? "ok" : "info"
  );
  setChatInlineHint(result.aborted ? "已发送停止请求" : "当前没有可停止的任务", result.aborted ? "ok" : "");
  await loadChatHistory({ sessionKey, silent: true }).catch(() => {});
}

async function resetChatConsoleSession() {
  const sessionKey = String(getInputValue("chat_session_select") || chatConsoleState.selectedSessionKey || "").trim();
  if (!sessionKey) {
    throw new Error("请先选择会话");
  }
  await api("/api/chat/session/reset", {
    method: "POST",
    body: JSON.stringify({
      sessionKey,
      reason: "reset"
    })
  });
  chatConsoleState.lastRunId = "";
  setInput("chat_last_run_id", "");
  setChatComposerSending(false);
  chatConsoleState.streamDeltasByRunId = {};
  chatConsoleState.streamThinkingByRunId = {};
  chatConsoleState.attachments = [];
  renderChatAttachments();
  setChatAttachmentHint("支持点击上传、粘贴或拖拽文件（图片会显示预览）");
  renderChatMessageList();
  setMessage(`会话已重置：${sessionKey}`, "ok");
  setChatInlineHint("会话已清空", "ok");
  await loadChatHistory({ sessionKey, silent: true }).catch(() => {});
}

function setupChatConsole() {
  if (chatConsoleState.bound) {
    return;
  }
  chatConsoleState.bound = true;
  setChatStreamStatus("未连接");
  setChatComposerSending(false);
  renderChatAttachments();
  setChatAttachmentHint("支持点击上传、粘贴或拖拽文件（图片会显示预览）");
  setChatInlineHint("");
  setupChatAttachmentInput();
  const sessionSelect = document.querySelector("#chat_session_select");
  sessionSelect?.addEventListener("change", () => {
    const selected = String(sessionSelect.value || "").trim();
    chatConsoleState.selectedSessionKey = selected;
    setChatComposerSending(false);
    chatConsoleState.attachments = [];
    renderChatAttachments();
    setChatAttachmentHint("支持点击上传、粘贴或拖拽文件（图片会显示预览）");
    connectChatStream(selected, { silent: true, force: true });
    loadChatHistory({ sessionKey: selected }).catch((error) => setMessage(error.message || String(error), "error"));
  });

  document.querySelector("#chat_new_session")?.addEventListener("click", () => {
    createChatSession().catch((error) => reportChatActionError(error, "新建会话失败"));
  });
  document.querySelector("#chat_refresh_sessions")?.addEventListener("click", () => {
    loadChatSessions()
      .then(() => setChatInlineHint("会话列表已刷新", "ok"))
      .catch((error) => reportChatActionError(error, "刷新会话失败"));
  });
  document.querySelector("#chat_load_history")?.addEventListener("click", () => {
    loadChatHistory()
      .then(() => setChatInlineHint("会话历史已刷新", "ok"))
      .catch((error) => reportChatActionError(error, "刷新历史失败"));
  });
  document.querySelector("#chat_reconnect_stream")?.addEventListener("click", () => {
    connectChatStream(chatConsoleState.selectedSessionKey, { force: true });
    setChatInlineHint("已触发实时通道重连", "ok");
  });
  document.querySelector("#chat_send_message")?.addEventListener("click", () => {
    sendChatConsoleMessage().catch((error) => reportChatActionError(error, "发送失败"));
  });
  const messageInput = document.querySelector("#chat_message_input");
  messageInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChatConsoleMessage().catch((error) => reportChatActionError(error, "发送失败"));
    }
  });
  document.querySelector("#chat_show_thinking")?.addEventListener("change", () => {
    renderChatMessageList();
  });
  document.querySelector("#chat_abort_run")?.addEventListener("click", () => {
    abortChatConsoleRun().catch((error) => reportChatActionError(error, "停止失败"));
  });
  document.querySelector("#chat_reset_session")?.addEventListener("click", () => {
    resetChatConsoleSession().catch((error) => reportChatActionError(error, "重置会话失败"));
  });

  window.addEventListener("beforeunload", () => {
    closeChatStreamSource();
  });
}

function setSelectValueWithCustom(selectId, customInputId, rawValue) {
  const selectEl = document.querySelector(`#${selectId}`);
  if (!selectEl) {
    return;
  }
  const customEl = customInputId ? document.querySelector(`#${customInputId}`) : null;
  const value = String(rawValue || "").trim();
  const hasPresetOption = Array.from(selectEl.options || []).some((option) => option.value === value);

  if (hasPresetOption) {
    selectEl.value = value;
    if (customEl) {
      customEl.value = "";
      customEl.classList.remove("is-visible");
    }
    return;
  }

  if (Array.from(selectEl.options || []).some((option) => option.value === "custom")) {
    selectEl.value = "custom";
    if (customEl) {
      customEl.value = value;
      customEl.classList.add("is-visible");
    }
    return;
  }

  selectEl.value = value;
}

function getSelectValueWithCustom(selectId, customInputId) {
  const selectEl = document.querySelector(`#${selectId}`);
  if (!selectEl) {
    return "";
  }
  if (String(selectEl.value || "") !== "custom") {
    return String(selectEl.value || "").trim();
  }
  const customEl = customInputId ? document.querySelector(`#${customInputId}`) : null;
  return String(customEl?.value || "").trim();
}

function renderTemplatePreset(templateKey, options = {}) {
  const template = MODEL_TEMPLATE_MAP[templateKey] || MODEL_TEMPLATE_MAP["aicodecat-gpt"];
  const apiMode = String(options.apiOverride || template.api || "").trim();
  const isAicodecatTemplate = String(template.providerId || "").startsWith("aicodecat-");
  const preferredModelId = String(options.defaultModelId || getInputValue("template_default_model_id") || "").trim();

  setInput("template_provider_id", template.providerId);
  setSelectValueWithCustom("template_api", "template_api_custom", apiMode);
  setInput("template_base_url", isAicodecatTemplate ? resolveAicodecatBaseUrl(apiMode) : template.baseUrl);

  const defaultModelSelect = document.querySelector("#template_default_model_id");
  if (defaultModelSelect) {
    fillDefaultModelOptions(defaultModelSelect, {
      selectedValue: preferredModelId
    });
    const fallbackModelId = template.models[0]?.id || DEFAULT_MODEL_OPTIONS[0]?.id || "";
    const targetModelId = String(defaultModelSelect.value || "").trim() || fallbackModelId;
    defaultModelSelect.value = targetModelId;
  }

  const preview = document.querySelector("#template_model_preview");
  if (preview) {
    preview.textContent = template.models
      .map(
        (item) =>
          `- ${item.name} (${item.id}) | 输入: ${(item.input || []).join("+")} | 思考: ${
            item.reasoning ? "开启" : "关闭"
          } | 上下文: ${item.contextWindow} | 最大输出: ${item.maxTokens}`
      )
      .join("\n");
  }

  setInput("custom_models_json", JSON.stringify(template.models, null, 2));
  setSelectValueWithCustom("custom_api", "custom_api_custom", apiMode || template.api);
  setInput("custom_base_url", isAicodecatTemplate ? resolveAicodecatBaseUrl(apiMode) : template.baseUrl);
  setInput("custom_provider_id", template.providerId);
  const customDefaultModelSelect = document.querySelector("#custom_default_model_id");
  const nextDefaultModelId = String(
    getInputValue("template_default_model_id") || template.models[0]?.id || DEFAULT_MODEL_OPTIONS[0]?.id || ""
  );
  if (customDefaultModelSelect) {
    fillDefaultModelOptions(customDefaultModelSelect, {
      includeCustom: true,
      selectedValue: nextDefaultModelId
    });
  }
  setSelectValueWithCustom("custom_default_model_id", "custom_default_model_id_custom", nextDefaultModelId);
}

function fillModelEditor(modelSettings) {
  const catalog = modelSettings?.catalog || { providers: [], modelRefs: [] };
  const catalogRefs = Array.isArray(catalog.modelRefs) ? catalog.modelRefs : [];
  modelEditorState.currentModelSettings = modelSettings || null;
  modelEditorState.modelCatalog = {
    providers: Array.isArray(catalog.providers) ? catalog.providers : [],
    modelRefs: catalogRefs
  };

  const generatorModelRefs = readGeneratorDefaultModelRefs();
  const selectableModelRefs = [];
  const seenRefs = new Set();

  generatorModelRefs.forEach((baseEntry) => {
    const matched = catalogRefs.find(
      (item) => item?.ref === baseEntry.ref || (item?.providerId === baseEntry.providerId && item?.modelId === baseEntry.modelId)
    );
    const merged = matched ? { ...baseEntry, ...matched } : baseEntry;
    const ref = String(merged?.ref || "").trim();
    if (!ref || seenRefs.has(ref)) {
      return;
    }
    seenRefs.add(ref);
    selectableModelRefs.push(merged);
  });

  catalogRefs.forEach((entry) => {
    const ref = String(entry?.ref || "").trim();
    if (!ref || seenRefs.has(ref)) {
      return;
    }
    seenRefs.add(ref);
    selectableModelRefs.push(entry);
  });

  const currentPrimary = String(modelSettings?.primary || "").trim();
  if (currentPrimary && !seenRefs.has(currentPrimary)) {
    const fallbackCurrent = {
      ref: currentPrimary,
      providerId: modelSettings.providerId,
      providerApi: modelSettings.providerApi,
      providerBaseUrl: modelSettings.providerBaseUrl,
      modelId: modelSettings.modelId,
      modelName: modelSettings.modelName,
      contextWindow: modelSettings.contextWindow,
      maxTokens: modelSettings.maxTokens,
      thinkingStrength: modelSettings.thinkingStrength || "无"
    };
    seenRefs.add(currentPrimary);
    selectableModelRefs.push(fallbackCurrent);
  }

  if (selectableModelRefs.length === 0 && currentPrimary) {
    selectableModelRefs.push({
      ref: currentPrimary,
      providerId: modelSettings.providerId,
      providerApi: modelSettings.providerApi,
      providerBaseUrl: modelSettings.providerBaseUrl,
      modelId: modelSettings.modelId,
      modelName: modelSettings.modelName,
      contextWindow: modelSettings.contextWindow,
      maxTokens: modelSettings.maxTokens,
      thinkingStrength: modelSettings.thinkingStrength || "无"
    });
  }

  modelEditorState.defaultModelRefs = selectableModelRefs;

  const defaultSelect = document.querySelector("#model_default_ref");
  if (defaultSelect) {
    defaultSelect.innerHTML = "";
    modelEditorState.defaultModelRefs.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.ref;
      option.textContent = entry.modelId || entry.modelName || entry.ref;
      defaultSelect.appendChild(option);
    });
    if (modelSettings.primary && modelEditorState.defaultModelRefs.some((entry) => entry.ref === modelSettings.primary)) {
      defaultSelect.value = modelSettings.primary;
    } else if (defaultSelect.options.length > 0) {
      defaultSelect.selectedIndex = 0;
    }
  }

  const selectedEntry =
    modelEditorState.defaultModelRefs.find((entry) => entry.ref === modelSettings.primary) ||
    modelEditorState.defaultModelRefs[0] || {
      ref: modelSettings.primary,
      providerId: modelSettings.providerId,
      providerApi: modelSettings.providerApi,
      providerBaseUrl: modelSettings.providerBaseUrl,
      modelId: modelSettings.modelId,
      modelName: modelSettings.modelName,
      contextWindow: modelSettings.contextWindow,
      maxTokens: modelSettings.maxTokens
    };

  renderModelSummary(selectedEntry, selectedEntry.ref || modelSettings.primary);
  modelEditorState.currentModelPayload = buildModelPayload({
    primary: modelSettings.primary || selectedEntry.ref,
    providerId: modelSettings.providerId || selectedEntry.providerId,
    providerApi: modelSettings.providerApi || selectedEntry.providerApi,
    providerBaseUrl: modelSettings.providerBaseUrl || selectedEntry.providerBaseUrl,
    providerApiKey: "",
    modelId: modelSettings.modelId || selectedEntry.modelId,
    modelName: modelSettings.modelName || selectedEntry.modelName || selectedEntry.modelId,
    contextWindow: modelSettings.contextWindow || selectedEntry.contextWindow,
    maxTokens: modelSettings.maxTokens || selectedEntry.maxTokens,
    providerModels: []
  });
  setInput("template_set_as_primary", false);
  setInput("custom_set_as_primary", false);
  setModelProviderMode("template");

  fillDashboardQuickSwitch(modelSettings);
}

function setupModelEditor() {
  const defaultSelect = document.querySelector("#model_default_ref");
  if (!defaultSelect || defaultSelect.dataset.bound === "1") {
    return;
  }
  defaultSelect.dataset.bound = "1";

  document.querySelectorAll("[data-model-flow-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = String(button.getAttribute("data-model-flow-jump") || "").trim();
      if (!targetId) {
        return;
      }
      const target = document.getElementById(targetId);
      if (!target) {
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setMessage(`已定位到：${target.querySelector("h2")?.textContent || targetId}`, "info");
    });
  });

  document.querySelectorAll("[data-model-provider-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetMode = String(button.getAttribute("data-model-provider-mode") || "").trim();
      setModelProviderMode(targetMode);
    });
  });
  setModelProviderMode(modelEditorState.providerMode || "template");

  const templateSelect = document.querySelector("#model_template_key");
  templateSelect?.addEventListener("change", () => {
    renderTemplatePreset(String(templateSelect.value || "aicodecat-gpt"));
  });

  const templateApiSelect = document.querySelector("#template_api");
  const templateApiCustomInput = document.querySelector("#template_api_custom");
  const templateDefaultModelSelect = document.querySelector("#template_default_model_id");
  const syncTemplateByApiMode = () => {
    const providerId = String(getInputValue("template_provider_id") || "").trim();
    const apiMode = getSelectValueWithCustom("template_api", "template_api_custom");
    const selectedModelId = String(getInputValue("template_default_model_id") || "").trim();
    if (!providerId || !apiMode) {
      return;
    }

    const isAicodecatProvider = providerId === AICODECAT_PROVIDER || providerId.startsWith("aicodecat-");
    if (!isAicodecatProvider) {
      return;
    }

    const resolvedProviderId = resolveProviderId(AICODECAT_PROVIDER, apiMode);
    if (!MODEL_TEMPLATE_MAP[resolvedProviderId]) {
      return;
    }

    if (templateSelect) {
      templateSelect.value = resolvedProviderId;
    }
    renderTemplatePreset(resolvedProviderId, { apiOverride: apiMode, defaultModelId: selectedModelId });
  };

  const syncTemplateByModelSelection = () => {
    const selectedModelId = String(getInputValue("template_default_model_id") || "").trim();
    if (!selectedModelId) {
      return;
    }

    const family = modelFamilyById(selectedModelId);
    const profile = MODEL_PROFILE_BY_FAMILY[family] || MODEL_PROFILE_BY_FAMILY.gpt;
    const providerApi = profile.apiMode;
    const providerId = resolveProviderId(AICODECAT_PROVIDER, providerApi);
    if (!MODEL_TEMPLATE_MAP[providerId]) {
      return;
    }

    if (templateSelect) {
      templateSelect.value = providerId;
    }
    renderTemplatePreset(providerId, { apiOverride: providerApi, defaultModelId: selectedModelId });
  };

  const refreshTemplateApiCustomInput = () => {
    if (!templateApiSelect || !templateApiCustomInput) {
      return;
    }
    const useCustom = String(templateApiSelect.value || "") === "custom";
    templateApiCustomInput.classList.toggle("is-visible", useCustom);
  };

  templateApiSelect?.addEventListener("change", () => {
    refreshTemplateApiCustomInput();
    syncTemplateByApiMode();
  });
  templateApiCustomInput?.addEventListener("input", () => {
    if (String(templateApiSelect?.value || "") !== "custom") {
      return;
    }
    syncTemplateByApiMode();
  });
  templateDefaultModelSelect?.addEventListener("change", () => {
    syncTemplateByModelSelection();
  });
  refreshTemplateApiCustomInput();

  const customApiSelect = document.querySelector("#custom_api");
  const customApiCustomInput = document.querySelector("#custom_api_custom");
  const customDefaultModelSelect = document.querySelector("#custom_default_model_id");
  const customDefaultModelCustomInput = document.querySelector("#custom_default_model_id_custom");
  const customProviderInput = document.querySelector("#custom_provider_id");

  const syncCustomByApiMode = () => {
    const providerId = String(getInputValue("custom_provider_id") || "").trim();
    const apiMode = getSelectValueWithCustom("custom_api", "custom_api_custom");
    if (!providerId || !apiMode) {
      return;
    }
    const isAicodecatProvider = providerId === AICODECAT_PROVIDER || providerId.startsWith("aicodecat-");
    if (!isAicodecatProvider) {
      return;
    }
    const resolvedProviderId = resolveProviderId(AICODECAT_PROVIDER, apiMode);
    setInput("custom_provider_id", resolvedProviderId);
    setInput("custom_base_url", resolveAicodecatBaseUrl(apiMode));
  };

  const syncCustomByModelSelection = () => {
    const providerId = String(getInputValue("custom_provider_id") || "").trim();
    const selectedModelId = getSelectValueWithCustom("custom_default_model_id", "custom_default_model_id_custom");
    if (!providerId || !selectedModelId) {
      return;
    }
    const isAicodecatProvider = providerId === AICODECAT_PROVIDER || providerId.startsWith("aicodecat-");
    if (!isAicodecatProvider) {
      return;
    }
    const family = modelFamilyById(selectedModelId);
    const profile = MODEL_PROFILE_BY_FAMILY[family] || MODEL_PROFILE_BY_FAMILY.gpt;
    const providerApi = profile.apiMode;
    setSelectValueWithCustom("custom_api", "custom_api_custom", providerApi);
    syncCustomByApiMode();
  };

  const refreshCustomApiCustomInput = () => {
    if (!customApiSelect || !customApiCustomInput) {
      return;
    }
    const useCustom = String(customApiSelect.value || "") === "custom";
    customApiCustomInput.classList.toggle("is-visible", useCustom);
  };

  const refreshCustomDefaultModelCustomInput = () => {
    if (!customDefaultModelSelect || !customDefaultModelCustomInput) {
      return;
    }
    const useCustom = String(customDefaultModelSelect.value || "") === "custom";
    customDefaultModelCustomInput.classList.toggle("is-visible", useCustom);
  };

  customApiSelect?.addEventListener("change", () => {
    refreshCustomApiCustomInput();
    syncCustomByApiMode();
  });
  customApiCustomInput?.addEventListener("input", () => {
    if (String(customApiSelect?.value || "") !== "custom") {
      return;
    }
    syncCustomByApiMode();
  });
  customDefaultModelSelect?.addEventListener("change", () => {
    refreshCustomDefaultModelCustomInput();
    syncCustomByModelSelection();
  });
  customDefaultModelCustomInput?.addEventListener("input", () => {
    if (String(customDefaultModelSelect?.value || "") !== "custom") {
      return;
    }
    syncCustomByModelSelection();
  });
  customProviderInput?.addEventListener("change", () => {
    syncCustomByApiMode();
  });
  refreshCustomApiCustomInput();
  refreshCustomDefaultModelCustomInput();

  defaultSelect.addEventListener("change", () => {
    const selectedRef = String(defaultSelect.value || "");
    const entry = modelEditorState.defaultModelRefs.find((item) => item.ref === selectedRef);
    renderModelSummary(entry || {}, selectedRef);
  });

  document.querySelector("#save_default_model")?.addEventListener("click", () => {
    const selectedRef = String(getInputValue("model_default_ref") || "").trim();
    const entry = modelEditorState.defaultModelRefs.find((item) => item.ref === selectedRef);
    if (!entry) {
      setMessage("默认模型无效，请先选择一个可用模型", "error");
      return;
    }
    const payload = buildModelPayload({
      primary: entry.ref,
      providerId: entry.providerId,
      providerApi: entry.providerApi,
      providerBaseUrl: entry.providerBaseUrl,
      providerApiKey: "",
      modelId: entry.modelId,
      modelName: entry.modelName || entry.modelId,
      contextWindow: entry.contextWindow || 200000,
      maxTokens: entry.maxTokens || 8192,
      providerModels: []
    });
    saveModelSettings(payload, "默认模型已更新").catch((error) => setMessage(error.message, "error"));
  });

  document.querySelector("#save_provider_template")?.addEventListener("click", () => {
    const templateKey = String(getInputValue("model_template_key") || "").trim();
    const template = MODEL_TEMPLATE_MAP[templateKey];
    if (!template) {
      setMessage("模板不存在，请重新选择", "error");
      return;
    }
    const providerId = String(getInputValue("template_provider_id") || "").trim();
    const providerApi = getSelectValueWithCustom("template_api", "template_api_custom");
    const providerBaseUrl = String(getInputValue("template_base_url") || "").trim();
    const providerApiKey = String(getInputValue("template_api_key") || "").trim();
    const defaultModelId =
      String(getInputValue("template_default_model_id") || "").trim() || template.models[0]?.id || DEFAULT_MODEL_OPTIONS[0]?.id;
    const defaultModel =
      template.models.find((item) => item.id === defaultModelId) ||
      DEFAULT_MODEL_OPTIONS.find((item) => item.id === defaultModelId) ||
      template.models[0];

    if (!providerId || !providerApi || !providerBaseUrl || !defaultModel) {
      setMessage("模板配置不完整，请检查提供商名称 / API 模式 / URL / 默认模型", "error");
      return;
    }

    const providerModels = template.models.map((item) => ({ ...item }));
    const targetPrimaryRef = `${providerId}/${defaultModel.id}`;
    const primaryRef = resolveProviderSavePrimaryRef(targetPrimaryRef, "template_set_as_primary");
    if (!primaryRef) {
      setMessage("无法确定默认模型指向，请先在路径 1 设置默认模型或勾选“保存后设为当前默认模型”", "error");
      return;
    }

    const payload = buildModelPayload({
      primary: primaryRef,
      providerId,
      providerApi,
      providerBaseUrl,
      providerApiKey,
      modelId: defaultModel.id,
      modelName: defaultModel.name || defaultModel.id,
      contextWindow: defaultModel.contextWindow,
      maxTokens: defaultModel.maxTokens,
      providerModels
    });
    const shouldSwitchPrimary = Boolean(getInputValue("template_set_as_primary"));
    const actionLabel = shouldSwitchPrimary ? "模板提供商已写入，默认模型已切换" : "模板提供商已写入（默认模型未变）";
    saveModelSettings(payload, actionLabel).catch((error) => setMessage(error.message, "error"));
  });

  document.querySelector("#save_provider_custom")?.addEventListener("click", () => {
    const providerId = String(getInputValue("custom_provider_id") || "").trim();
    const providerApi = getSelectValueWithCustom("custom_api", "custom_api_custom");
    const providerBaseUrl = String(getInputValue("custom_base_url") || "").trim();
    const providerApiKey = String(getInputValue("custom_api_key") || "").trim();
    const defaultModelId = getSelectValueWithCustom("custom_default_model_id", "custom_default_model_id_custom");
    const rawModels = String(getInputValue("custom_models_json") || "").trim();
    if (!providerId || !providerApi || !providerBaseUrl || !rawModels) {
      setMessage("自定义配置不完整，请至少填写提供商名称 / API 模式 / URL / models JSON", "error");
      return;
    }

    let parsedModels;
    try {
      parsedModels = JSON.parse(rawModels);
    } catch (error) {
      setMessage(`models JSON 解析失败：${error.message}`, "error");
      return;
    }
    if (!Array.isArray(parsedModels) || parsedModels.length === 0) {
      setMessage("models JSON 必须是非空数组", "error");
      return;
    }

    const normalizedModels = parsedModels.map((item) => normalizeModelDraft(item)).filter(Boolean);
    const selectedDefaultModelId = defaultModelId || normalizedModels[0]?.id;
    const defaultModel = normalizedModels.find((item) => item.id === selectedDefaultModelId);
    if (!defaultModel) {
      setMessage("默认模型 ID 未命中 models 数组，请检查 custom_default_model_id", "error");
      return;
    }

    const targetPrimaryRef = `${providerId}/${defaultModel.id}`;
    const primaryRef = resolveProviderSavePrimaryRef(targetPrimaryRef, "custom_set_as_primary");
    if (!primaryRef) {
      setMessage("无法确定默认模型指向，请先在路径 1 设置默认模型或勾选“保存后设为当前默认模型”", "error");
      return;
    }

    const payload = buildModelPayload({
      primary: primaryRef,
      providerId,
      providerApi,
      providerBaseUrl,
      providerApiKey,
      modelId: defaultModel.id,
      modelName: defaultModel.name || defaultModel.id,
      contextWindow: defaultModel.contextWindow,
      maxTokens: defaultModel.maxTokens,
      providerModels: normalizedModels
    });
    const shouldSwitchPrimary = Boolean(getInputValue("custom_set_as_primary"));
    const actionLabel = shouldSwitchPrimary ? "自定义提供商已写入，默认模型已切换" : "自定义提供商已写入（默认模型未变）";
    saveModelSettings(payload, actionLabel).catch((error) => setMessage(error.message, "error"));
  });

  renderTemplatePreset(String(getInputValue("model_template_key") || "aicodecat-gpt"));
}

function fillSettings(settings) {
  renderDashboardModelCards(settings.model);
  fillModelEditor(settings.model);

  setInput("tg_enabled", settings.channels.telegram.enabled);
  setInput("tg_bot_token", settings.channels.telegram.botToken);
  setInput("tg_dm_policy", settings.channels.telegram.dmPolicy);
  setInput("tg_allow_from", settings.channels.telegram.allowFrom);
  setInput("tg_group_policy", settings.channels.telegram.groupPolicy);
  setInput("tg_group_allow_from", settings.channels.telegram.groupAllowFrom);
  setInput("tg_require_mention", settings.channels.telegram.requireMention);
  setInput("tg_stream_mode", settings.channels.telegram.streamMode);

  setInput("fs_enabled", settings.channels.feishu.enabled);
  setInput("fs_app_id", settings.channels.feishu.appId);
  setInput("fs_app_secret", settings.channels.feishu.appSecret);
  setInput("fs_domain", settings.channels.feishu.domain);
  setInput("fs_connection_mode", settings.channels.feishu.connectionMode);
  setInput("fs_dm_policy", settings.channels.feishu.dmPolicy);
  setInput("fs_allow_from", settings.channels.feishu.allowFrom);
  setInput("fs_group_policy", settings.channels.feishu.groupPolicy);
  setInput("fs_group_allow_from", settings.channels.feishu.groupAllowFrom);
  setInput("fs_require_mention", settings.channels.feishu.requireMention);

  setInput("dc_enabled", settings.channels.discord.enabled);
  setInput("dc_token", settings.channels.discord.token);
  setInput("dc_dm_policy", settings.channels.discord.dmPolicy);
  setInput("dc_allow_from", settings.channels.discord.allowFrom);
  setInput("dc_group_policy", settings.channels.discord.groupPolicy);
  setInput("dc_allow_bots", settings.channels.discord.allowBots);
  setInput("dc_require_mention", settings.channels.discord.requireMention);

  setInput("sl_enabled", settings.channels.slack.enabled);
  setInput("sl_mode", settings.channels.slack.mode);
  setInput("sl_bot_token", settings.channels.slack.botToken);
  setInput("sl_app_token", settings.channels.slack.appToken);
  setInput("sl_signing_secret", settings.channels.slack.signingSecret);
  setInput("sl_dm_policy", settings.channels.slack.dmPolicy);
  setInput("sl_allow_from", settings.channels.slack.allowFrom);
  setInput("sl_group_policy", settings.channels.slack.groupPolicy);
  setInput("sl_allow_bots", settings.channels.slack.allowBots);
  setInput("sl_require_mention", settings.channels.slack.requireMention);
}

async function loadInitialData() {
  const [panelConfig, settings] = await Promise.all([api("/api/panel-config"), api("/api/settings")]);
  fillPanelMeta(panelConfig.config, panelConfig.deployment || {});
  fillSettings(settings.settings);
}

async function checkUpdate({ silent = false } = {}) {
  const result = await api("/api/update/check");
  const data = result.result;
  setInput("update_current_tag", data.currentTag || "");
  setInput("update_latest_tag", data.latestTag || "");
  if (!String(getInputValue("update_target_tag") || "").trim() && data.latestTag) {
    setInput("update_target_tag", data.latestTag);
  }

  if (data.warning) {
    setUpdateState("检查异常", "fail");
    els.updateHint.textContent = `已读取当前版本，但远程版本检查失败：${data.warning}`;
    updateDashboardVersionSummary(data);
    if (!silent) {
      setMessage(`更新检查告警：${data.warning}`, "error");
    }
    return;
  }

  if (data.updateAvailable) {
    setUpdateState("有可用更新", "success");
    els.updateHint.textContent = `当前 ${data.currentTag || "-"}，最新 ${data.latestTag || "-"}。`;
  } else {
    setUpdateState("已是最新", "success");
    els.updateHint.textContent = `当前 ${data.currentTag || "-"}，无需升级。`;
  }
  updateDashboardVersionSummary(data);
  if (!silent) {
    setMessage(`版本检查完成：current=${data.currentTag || "-"} latest=${data.latestTag || "-"}`, "ok");
  }
}

async function mutateVersion(action) {
  const tag = String(getInputValue("update_target_tag") || "").trim();
  if (!tag) {
    throw new Error("请先输入目标版本");
  }
  const result = await api(`/api/update/${action}`, {
    method: "POST",
    body: JSON.stringify({ tag }),
    allowBusinessError: true
  });
  const payload = result.result || {};
  if (payload.ok) {
    setUpdateState(action === "upgrade" ? "升级成功" : "回滚成功", "success");
    els.updateHint.textContent = `当前镜像：${payload.targetImage}`;
    setInput("update_current_tag", payload.targetImage?.split(":").pop() || "");
    setMessage(`${action} 成功：${payload.targetImage}`, "ok");
    await runService("status");
    await loadTail();
    return;
  }

  setUpdateState(action === "upgrade" ? "升级失败" : "回滚失败", "fail");
  const rollbackNote = payload.rollbackMessage ? `；${payload.rollbackMessage}` : payload.rolledBack ? "；已自动回滚" : "";
  const detail = `${payload.message || "操作失败"}${rollbackNote}`;
  els.updateHint.textContent = detail;
  setMessage(`${action} 失败：${detail}`, "error");
}

async function saveModelSettings(modelPayload, actionLabel) {
  const payload = {
    model: modelPayload
  };
  const result = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  modelEditorState.currentModelPayload = modelPayload;
  setMessage(`${actionLabel}：${result.path}`, "ok");
  await loadInitialData();
}

async function saveSettings() {
  if (!modelEditorState.currentModelPayload) {
    throw new Error("模型配置尚未初始化，请刷新页面后重试");
  }
  const payload = {
    model: modelEditorState.currentModelPayload,
    channels: collectChannelSettings()
  };
  const result = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  setMessage(`渠道配置写入成功（模型保持当前值）：${result.path}`, "ok");
  await loadInitialData();
}

async function runService(action) {
  const result = await api(`/api/service/${action}`, {
    method: "POST",
    allowBusinessError: true
  });
  const payload = result.result || {};
  const output = payload.output || payload.message || "(empty)";
  els.serviceOutput.textContent = output;

  if (!result.ok) {
    if (action === "status") {
      els.serviceState.textContent = "状态异常";
      els.serviceState.classList.toggle("success", false);
      els.serviceState.classList.toggle("fail", true);
      els.serviceHint.textContent = payload.message || "服务状态读取失败，请检查容器或 systemd 权限。";
    }
    setMessage(`service ${action}: 失败 - ${payload.message || "未知错误"}`, "error");
    return;
  }

  if (action === "status") {
    const active = Boolean(payload.active);
    els.serviceState.textContent = active ? "运行中" : "未运行";
    els.serviceState.classList.toggle("success", active);
    els.serviceState.classList.toggle("fail", !active);
    els.serviceHint.textContent = active
      ? "服务状态正常。你可以继续联调渠道或查看日志。"
      : "服务未运行。请先启动或检查 systemd 权限。";
  }
  setMessage(`service ${action}: 成功`, "ok");
}

async function loadTail() {
  const filter = encodeURIComponent(String(getInputValue("log_filter") || ""));
  const result = await api(`/api/logs/tail?lines=200&filter=${filter}`);
  els.logOutput.textContent = result.lines.join("\n");
  setMessage(`日志加载完成，共 ${result.lines.length} 行`, "ok");
}

async function loadErrorSummary({ silent = false } = {}) {
  const result = await api("/api/logs/errors?count=20");
  els.errorSummary.innerHTML = "";
  result.lines.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    els.errorSummary.appendChild(li);
  });
  updateDashboardErrorSummary(result.lines);
  if (!silent) {
    setMessage(`错误摘要加载完成，共 ${result.lines.length} 条`, "ok");
  }
}

function stopStream() {
  if (stream) {
    stream.close();
    stream = null;
    setMessage("实时日志流已停止", "info");
  }
}

function startStream() {
  stopStream();
  const filter = encodeURIComponent(String(getInputValue("log_filter") || ""));
  stream = new EventSource(`/api/logs/stream?filter=${filter}`);
  stream.addEventListener("line", (event) => {
    const payload = JSON.parse(event.data);
    const next = `${payload.line}\n${els.logOutput.textContent}`;
    els.logOutput.textContent = next.slice(0, 30000);
  });
  stream.addEventListener("error", () => {
    setMessage("日志流出现错误，请检查日志来源配置", "error");
  });
  setMessage("实时日志流已启动", "ok");
}

function setChannelTestResult(elementId, detail, success) {
  const el = document.querySelector(`#${elementId}`);
  if (!el) {
    return;
  }
  const timestamp = new Date().toLocaleTimeString();
  el.textContent = `最近测试（${timestamp}）：${success ? "成功" : "失败"} - ${detail}`;
  el.classList.toggle("success", Boolean(success));
  el.classList.toggle("fail", !success);
}

async function saveAndTestTelegram() {
  const botToken = String(getInputValue("tg_bot_token") || "").trim();
  await saveSettings();
  if (botToken) {
    setInput("tg_bot_token", botToken);
  }
  await testTelegram();
}

async function saveAndTestFeishu() {
  const appId = String(getInputValue("fs_app_id") || "").trim();
  const appSecret = String(getInputValue("fs_app_secret") || "").trim();
  await saveSettings();
  if (appId) {
    setInput("fs_app_id", appId);
  }
  if (appSecret) {
    setInput("fs_app_secret", appSecret);
  }
  await testFeishu();
}

async function testTelegram() {
  const payload = {
    botToken: String(getInputValue("tg_bot_token") || "")
  };
  if (!payload.botToken) {
    setChannelTestResult("tg_test_result", "失败：请先填写 Bot Token", false);
    throw new Error("Telegram 测试失败：Bot Token 不能为空");
  }
  const result = await api("/api/test/telegram", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setChannelTestResult("tg_test_result", result.message || "-", result.ok);
  setMessage(`Telegram 测试：${result.message}`, result.ok ? "ok" : "error");
}

async function testFeishu() {
  const payload = {
    appId: String(getInputValue("fs_app_id") || ""),
    appSecret: String(getInputValue("fs_app_secret") || "")
  };
  if (!payload.appId || !payload.appSecret) {
    setChannelTestResult("fs_test_result", "失败：请先填写 App ID 与 App Secret", false);
    throw new Error("Feishu 测试失败：App ID / App Secret 不能为空");
  }
  const result = await api("/api/test/feishu", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setChannelTestResult("fs_test_result", result.message || "-", result.ok);
  setMessage(`Feishu 测试：${result.message}`, result.ok ? "ok" : "error");
}

async function testDiscord() {
  const payload = {
    token: String(getInputValue("dc_token") || "")
  };
  if (!payload.token) {
    setChannelTestResult("dc_test_result", "失败：请先填写 Discord Bot Token", false);
    throw new Error("Discord 测试失败：Bot Token 不能为空");
  }
  const result = await api("/api/test/discord", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setChannelTestResult("dc_test_result", result.message || "-", result.ok);
  setMessage(`Discord 测试：${result.message}`, result.ok ? "ok" : "error");
}

async function testSlack() {
  const mode = String(getInputValue("sl_mode") || "socket");
  const payload = {
    mode,
    botToken: String(getInputValue("sl_bot_token") || ""),
    appToken: String(getInputValue("sl_app_token") || ""),
    signingSecret: String(getInputValue("sl_signing_secret") || "")
  };
  if (!payload.botToken) {
    setChannelTestResult("sl_test_result", "失败：请先填写 Slack Bot Token", false);
    throw new Error("Slack 测试失败：Bot Token 不能为空");
  }
  if (mode === "socket" && !payload.appToken) {
    setChannelTestResult("sl_test_result", "失败：socket 模式需要 App Token", false);
    throw new Error("Slack 测试失败：socket 模式需要 App Token");
  }
  if (mode === "http" && !payload.signingSecret) {
    setChannelTestResult("sl_test_result", "失败：http 模式需要 Signing Secret", false);
    throw new Error("Slack 测试失败：http 模式需要 Signing Secret");
  }
  const result = await api("/api/test/slack", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setChannelTestResult("sl_test_result", result.message || "-", result.ok);
  setMessage(`Slack 测试：${result.message}`, result.ok ? "ok" : "error");
}

document.querySelector("#save_settings").addEventListener("click", () => {
  saveSettings().catch((error) => setMessage(error.message, "error"));
});

document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    runService(btn.dataset.action).catch((error) => setMessage(error.message, "error"));
  });
});

document.querySelector("#load_tail").addEventListener("click", () => {
  loadTail().catch((error) => setMessage(error.message, "error"));
});

document.querySelector("#load_errors").addEventListener("click", () => {
  loadErrorSummary().catch((error) => setMessage(error.message, "error"));
});

document.querySelector("#start_stream").addEventListener("click", startStream);
document.querySelector("#stop_stream").addEventListener("click", stopStream);
document.querySelector("#test_telegram").addEventListener("click", () => {
  testTelegram().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#save_and_test_telegram")?.addEventListener("click", () => {
  saveAndTestTelegram().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#test_feishu").addEventListener("click", () => {
  testFeishu().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#save_and_test_feishu")?.addEventListener("click", () => {
  saveAndTestFeishu().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#test_discord").addEventListener("click", () => {
  testDiscord().catch((error) => {
    setChannelTestResult("dc_test_result", `接口不可用或测试失败：${error.message || "未知错误"}`, false);
    setMessage(error.message, "error");
  });
});
document.querySelector("#test_slack").addEventListener("click", () => {
  testSlack().catch((error) => {
    setChannelTestResult("sl_test_result", `接口不可用或测试失败：${error.message || "未知错误"}`, false);
    setMessage(error.message, "error");
  });
});
document.querySelector("#check_update").addEventListener("click", () => {
  checkUpdate().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#upgrade_update").addEventListener("click", () => {
  mutateVersion("upgrade").catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#rollback_update").addEventListener("click", () => {
  mutateVersion("rollback").catch((error) => setMessage(error.message, "error"));
});

setupTheme();
setupTabs();
setupDashboard();
setupSkillsPage();
setupChatConsole();
setupModelEditor();
setupConfigGenerator();

loadInitialData()
  .then(() => {
    els.runtimeState.textContent = "面板已连接";
    setMessage("初始化完成", "ok");
    runService("status").catch(() => {});
    loadTail().catch(() => {});
    loadErrorSummary({ silent: true }).catch((error) => setMessage(`错误摘要加载失败：${error.message}`, "error"));
    checkUpdate({ silent: true }).catch((error) => setMessage(`版本信息加载失败：${error.message}`, "error"));
    loadStatusOverview({ silent: true }).catch((error) => setMessage(`状态总览加载失败：${error.message}`, "error"));
    loadSkillsStatus({ silent: true }).catch((error) => setMessage(`Skills 页面加载失败：${error.message}`, "error"));
    loadChatSessions({ silent: true }).catch((error) => setMessage(`智能对话页加载失败：${error.message}`, "error"));
  })
  .catch((error) => {
    els.runtimeState.textContent = "面板连接失败";
    setMessage(`初始化失败：${error.message}`, "error");
  });
