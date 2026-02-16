import { requestJson } from "../../app-api.js";
import { PANEL_ROUTES, isKnownPanelPath, panelByPath } from "../../app-routes.js";
import { AICODECAT_PROVIDER, resolveAicodecatBaseUrl, resolveProviderId } from "../../config-generator.js";

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

const channelSettingsSnapshot = {
  settings: null
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
  if (!els.messages) {
    return;
  }
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
  const hasPanel = (panelName) => panels.some((panel) => panel.dataset.panel === panelName);

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
      const targetPanel = String(tab.dataset.tabTarget || "").trim();
      if (!targetPanel || !hasPanel(targetPanel)) {
        return;
      }
      event.preventDefault();
      activate(targetPanel, { push: true });
    });
  });

  window.addEventListener("popstate", () => {
    activate(panelByPath(window.location.pathname));
  });

  const initialPanel = panelByPath(window.location.pathname);
  const shouldNormalizePath = !isKnownPanelPath(window.location.pathname);
  if (hasPanel(initialPanel)) {
    activate(initialPanel, { replace: shouldNormalizePath });
  } else if (panels.length > 0) {
    activate(panels[0].dataset.panel, { replace: shouldNormalizePath });
  }
}

function applyTheme(theme) {
  const value = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = value;
  document.body.dataset.theme = value;
  document.documentElement.classList.toggle("sl-theme-dark", value === "dark");
  document.documentElement.classList.toggle("sl-theme-light", value !== "dark");
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
  empty.className = "dashboard-list-empty";
  empty.textContent = message;
  container.appendChild(empty);
}

function createDashboardStatusTag(text, variant = "neutral") {
  const tag = document.createElement("sl-tag");
  tag.size = "small";
  tag.pill = true;
  tag.variant = variant;
  tag.textContent = text;
  return tag;
}

const hasPanel = (panelName) => Boolean(document.querySelector(`.panel[data-panel="${panelName}"]`));

export {
  AICODECAT_PROVIDER,
  DASHBOARD_CONTEXT_KEY,
  DEFAULT_MODEL_OPTIONS,
  MODEL_PROFILE_BY_FAMILY,
  MODEL_TEMPLATE_MAP,
  THEME_KEY,
  api,
  applyTheme,
  buildDefaultModelEntry,
  buildModelPayload,
  channelSettingsSnapshot,
  chatConsoleState,
  createDashboardStatusTag,
  dashboardSummaryState,
  els,
  fillDefaultModelOptions,
  formatLocalTime,
  getDashboardContextTokens,
  getInputValue,
  hasPanel,
  isKnownPanelPath,
  modelEditorState,
  modelFamilyById,
  normalizeModelDraft,
  panelByPath,
  parseModelRef,
  setInput,
  setMessage,
  setStackListEmpty,
  setText,
  setupTabs,
  setupTheme,
  skillsPageState,
  toNonNegativeInt,
  toPositiveInt
};
