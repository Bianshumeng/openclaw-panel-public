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
  currentModelPayload: null,
  dashboardBound: false
};

const els = {
  messages: document.querySelector("#messages"),
  serviceOutput: document.querySelector("#service_output"),
  logOutput: document.querySelector("#log_output"),
  errorSummary: document.querySelector("#error_summary"),
  runtimeState: document.querySelector("#runtime_state"),
  metaServiceName: document.querySelector("#meta_service_name"),
  metaLogSource: document.querySelector("#meta_log_source"),
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
    const currentValue = String(modelIdEl.value || "").trim();
    modelIdEl.innerHTML = "";
    DEFAULT_MODEL_OPTIONS.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.id;
      modelIdEl.appendChild(option);
    });
    const customOption = document.createElement("option");
    customOption.value = "custom";
    customOption.textContent = "自定义";
    modelIdEl.appendChild(customOption);

    const hasCurrent = DEFAULT_MODEL_OPTIONS.some((item) => item.id === currentValue);
    modelIdEl.value = hasCurrent ? currentValue : DEFAULT_MODEL_OPTIONS[0]?.id || "custom";
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

function fillPanelMeta(config) {
  const runtime = config.runtime?.mode || "systemd";
  const target =
    runtime === "docker" ? config.openclaw.container_name || config.openclaw.service_name : config.openclaw.service_name;
  els.metaServiceName.textContent = `target: ${target}`;
  els.metaLogSource.textContent = `log: ${config.log.source} (${runtime})`;
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
  const input = document.querySelector("#dashboard_context_tokens");
  return toNonNegativeInt(input?.value || "");
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
        const currentModelContext = Number(modelSettings?.contextWindow || 0) || undefined;
        const targetContext = Number(modelEntry.contextWindow || 0) || undefined;
        const currentContextTokens = getDashboardContextTokens();

        if (targetContext && currentContextTokens !== null && currentContextTokens > targetContext) {
          const proceed = window.confirm(
            `当前会话上下文约 ${currentContextTokens.toLocaleString()}，目标模型上限为 ${targetContext.toLocaleString()}。\n切换后可能因上下文超限报错，确认继续切换吗？`
          );
          if (!proceed) {
            return;
          }
        } else if (targetContext && currentContextTokens === null && currentModelContext && currentModelContext > targetContext) {
          const proceed = window.confirm(
            `目标模型上下文上限更小（${targetContext.toLocaleString()}），但你还没填写“当前会话上下文”。\n如果当前会话已超过目标上限，切换后会报错。确认继续切换吗？`
          );
          if (!proceed) {
            return;
          }
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
        saveModelSettings(payload, `已切换默认模型到 ${modelEntry.modelId}`).catch((error) =>
          setMessage(error.message || String(error), "error")
        );
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
  const contextInput = document.querySelector("#dashboard_context_tokens");
  if (!contextInput) {
    return;
  }

  const saved = toNonNegativeInt(localStorage.getItem(DASHBOARD_CONTEXT_KEY) || "");
  if (saved !== null) {
    contextInput.value = String(saved);
  }

  contextInput.addEventListener("input", () => {
    const parsed = toNonNegativeInt(contextInput.value || "");
    if (parsed === null) {
      localStorage.removeItem(DASHBOARD_CONTEXT_KEY);
      return;
    }
    localStorage.setItem(DASHBOARD_CONTEXT_KEY, String(parsed));
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
    defaultModelSelect.innerHTML = "";
    DEFAULT_MODEL_OPTIONS.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.id;
      defaultModelSelect.appendChild(option);
    });
    const fallbackModelId = template.models[0]?.id || DEFAULT_MODEL_OPTIONS[0]?.id || "";
    const targetModelId = preferredModelId && DEFAULT_MODEL_OPTIONS.some((item) => item.id === preferredModelId)
      ? preferredModelId
      : fallbackModelId;
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
  setInput("custom_api", apiMode || template.api);
  setInput("custom_base_url", isAicodecatTemplate ? resolveAicodecatBaseUrl(apiMode) : template.baseUrl);
  setInput("custom_provider_id", template.providerId);
  setInput(
    "custom_default_model_id",
    String(getInputValue("template_default_model_id") || template.models[0]?.id || DEFAULT_MODEL_OPTIONS[0]?.id || "")
  );
}

function fillModelEditor(modelSettings) {
  const catalog = modelSettings?.catalog || { providers: [], modelRefs: [] };
  const catalogRefs = Array.isArray(catalog.modelRefs) ? catalog.modelRefs : [];
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
}

function setupModelEditor() {
  const defaultSelect = document.querySelector("#model_default_ref");
  if (!defaultSelect || defaultSelect.dataset.bound === "1") {
    return;
  }
  defaultSelect.dataset.bound = "1";

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
    const payload = buildModelPayload({
      primary: `${providerId}/${defaultModel.id}`,
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
    saveModelSettings(payload, "模板提供商已写入").catch((error) => setMessage(error.message, "error"));
  });

  document.querySelector("#save_provider_custom")?.addEventListener("click", () => {
    const providerId = String(getInputValue("custom_provider_id") || "").trim();
    const providerApi = String(getInputValue("custom_api") || "").trim();
    const providerBaseUrl = String(getInputValue("custom_base_url") || "").trim();
    const providerApiKey = String(getInputValue("custom_api_key") || "").trim();
    const defaultModelId = String(getInputValue("custom_default_model_id") || "").trim();
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

    const payload = buildModelPayload({
      primary: `${providerId}/${defaultModel.id}`,
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
    saveModelSettings(payload, "自定义提供商已写入").catch((error) => setMessage(error.message, "error"));
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
  fillPanelMeta(panelConfig.config);
  fillSettings(settings.settings);
}

async function checkUpdate() {
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
    setMessage(`更新检查告警：${data.warning}`, "error");
    return;
  }

  if (data.updateAvailable) {
    setUpdateState("有可用更新", "success");
    els.updateHint.textContent = `当前 ${data.currentTag || "-"}，最新 ${data.latestTag || "-"}。`;
  } else {
    setUpdateState("已是最新", "success");
    els.updateHint.textContent = `当前 ${data.currentTag || "-"}，无需升级。`;
  }
  setMessage(`版本检查完成：current=${data.currentTag || "-"} latest=${data.latestTag || "-"}`, "ok");
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
  setMessage(`渠道与全局配置写入成功：${result.path}`, "ok");
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

async function loadErrorSummary() {
  const result = await api("/api/logs/errors?count=20");
  els.errorSummary.innerHTML = "";
  result.lines.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    els.errorSummary.appendChild(li);
  });
  setMessage(`错误摘要加载完成，共 ${result.lines.length} 条`, "ok");
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

async function testTelegram() {
  const payload = {
    botToken: String(getInputValue("tg_bot_token") || "")
  };
  const result = await api("/api/test/telegram", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setMessage(`Telegram 测试：${result.message}`, result.ok ? "ok" : "error");
}

async function testFeishu() {
  const payload = {
    appId: String(getInputValue("fs_app_id") || ""),
    appSecret: String(getInputValue("fs_app_secret") || "")
  };
  const result = await api("/api/test/feishu", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setMessage(`Feishu 测试：${result.message}`, result.ok ? "ok" : "error");
}

async function testDiscord() {
  const payload = {
    token: String(getInputValue("dc_token") || "")
  };
  const result = await api("/api/test/discord", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setMessage(`Discord 测试：${result.message}`, result.ok ? "ok" : "error");
}

async function testSlack() {
  const payload = {
    mode: String(getInputValue("sl_mode") || "socket"),
    botToken: String(getInputValue("sl_bot_token") || ""),
    appToken: String(getInputValue("sl_app_token") || ""),
    signingSecret: String(getInputValue("sl_signing_secret") || "")
  };
  const result = await api("/api/test/slack", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
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
document.querySelector("#test_feishu").addEventListener("click", () => {
  testFeishu().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#test_discord").addEventListener("click", () => {
  testDiscord().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#test_slack").addEventListener("click", () => {
  testSlack().catch((error) => setMessage(error.message, "error"));
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
setupModelEditor();
setupConfigGenerator();

loadInitialData()
  .then(() => {
    els.runtimeState.textContent = "面板已连接";
    setMessage("初始化完成", "ok");
    runService("status").catch(() => {});
    loadTail().catch(() => {});
    loadErrorSummary().catch(() => {});
    checkUpdate().catch(() => {});
  })
  .catch((error) => {
    els.runtimeState.textContent = "面板连接失败";
    setMessage(`初始化失败：${error.message}`, "error");
  });
