import {
  AICODECAT_PROVIDER,
  DASHBOARD_CONTEXT_KEY,
  DEFAULT_MODEL_OPTIONS,
  MODEL_PROFILE_BY_FAMILY,
  MODEL_TEMPLATE_MAP,
  api,
  buildDefaultModelEntry,
  buildModelPayload,
  createDashboardStatusTag,
  dashboardSummaryState,
  fillDefaultModelOptions,
  formatLocalTime,
  getDashboardContextTokens,
  getInputValue,
  modelEditorState,
  modelFamilyById,
  normalizeModelDraft,
  parseModelRef,
  setInput,
  setMessage,
  setStackListEmpty,
  setText,
  toNonNegativeInt
} from "../core/panel-core.js";
import { resolveAicodecatBaseUrl, resolveProviderId } from "../../config-generator.js";

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
  const parsedRef = parseModelRef(modelEntry.ref);
  const modelId = String(modelEntry?.modelId || parsedRef.modelId || modelEntry?.modelName || "-").trim() || "-";
  const providerId = String(modelEntry?.providerId || parsedRef.providerId || "-").trim() || "-";
  setText(
    "dashboard_quick_switch_hint",
    `将切换到：${modelId}（${providerId}）`
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
    const parsedRef = parseModelRef(entry.ref);
    const modelId = String(entry?.modelId || parsedRef.modelId || entry?.modelName || entry.ref || "").trim();
    const providerId = String(entry?.providerId || parsedRef.providerId || "-").trim() || "-";
    option.textContent = `${modelId || "-"}（${providerId}）`;
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

function resolveModelFamilyKey(modelEntry = {}) {
  const modelId = String(modelEntry?.modelId || "").trim().toLowerCase();
  const modelName = String(modelEntry?.modelName || "").trim().toLowerCase();
  const source = `${modelId} ${modelName}`.trim();
  if (source.startsWith("claude") || source.includes(" claude")) {
    return "claude";
  }
  if (source.startsWith("gemini") || source.includes(" gemini")) {
    return "gemini";
  }
  if (source.startsWith("gpt") || source.includes(" gpt")) {
    return "gpt";
  }
  return "other";
}

function setModelAddWorkspaceVisible(visible) {
  const workspace = document.querySelector("#model_add_workspace");
  const toggle = document.querySelector("#model_add_toggle");
  if (!workspace || !toggle) {
    return;
  }

  const nextVisible = Boolean(visible);
  workspace.classList.toggle("is-hidden", !nextVisible);
  workspace.setAttribute("aria-hidden", nextVisible ? "false" : "true");
  toggle.setAttribute("aria-expanded", nextVisible ? "true" : "false");
  toggle.classList.toggle("is-active", nextVisible);
  toggle.title = nextVisible ? "关闭添加模型面板" : "添加模型";
  const symbol = toggle.querySelector("span");
  if (symbol) {
    symbol.textContent = nextVisible ? "×" : "+";
  }
}

const modelMutationState = {
  pending: false,
  providerEditId: "",
  modelEditProviderId: "",
  modelEditId: "",
  dialogBound: false
};

const modelRawConfigState = {
  bound: false,
  pending: false,
  lastSyncMtimeMs: null
};

function getShoelaceDialog(id) {
  const dialog = document.querySelector(`#${id}`);
  if (!dialog || typeof dialog.show !== "function" || typeof dialog.hide !== "function") {
    return null;
  }
  return dialog;
}

function openShoelaceDialog(id) {
  const dialog = getShoelaceDialog(id);
  if (!dialog) {
    return;
  }
  dialog.show();
}

function closeShoelaceDialog(id) {
  const dialog = getShoelaceDialog(id);
  if (!dialog) {
    return;
  }
  dialog.hide();
}

function parseOptionalPositiveIntInput(rawValue, label) {
  const text = String(rawValue || "").trim();
  if (!text) {
    return undefined;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} 必须是正整数`);
  }
  return Math.floor(parsed);
}

async function runModelMutation(task) {
  if (modelMutationState.pending) {
    setMessage("模型配置正在写入，请稍等片刻再操作", "info");
    return;
  }
  modelMutationState.pending = true;
  try {
    await task();
  } finally {
    modelMutationState.pending = false;
  }
}

function setModelRawConfigStatus(message, type = "info") {
  const statusEl = document.querySelector("#model_raw_config_status");
  if (!statusEl) {
    return;
  }
  statusEl.textContent = String(message || "").trim();
  statusEl.classList.toggle("is-fail", type === "error");
  statusEl.classList.toggle("is-done", type === "ok");
}

function setModelRawConfigBusy(busy) {
  const isBusy = Boolean(busy);
  document.querySelector("#model_raw_config_reload")?.toggleAttribute("disabled", isBusy);
  document.querySelector("#model_raw_config_save")?.toggleAttribute("disabled", isBusy);
}

function applyModelRawConfigPayload(payload = {}) {
  const editor = document.querySelector("#model_raw_config_editor");
  if (!(editor instanceof HTMLTextAreaElement)) {
    return;
  }
  editor.value = String(payload.rawText || "");
  modelRawConfigState.lastSyncMtimeMs = Number.isFinite(Number(payload.mtimeMs)) ? Number(payload.mtimeMs) : null;
  setText("model_raw_config_mtime", payload.mtimeMs ? formatLocalTime(payload.mtimeMs) : "-");
  setText("model_raw_config_size", Number.isFinite(payload.size) ? `${payload.size} bytes` : "-");
}

async function loadModelRawConfig({ silent = false } = {}) {
  const editor = document.querySelector("#model_raw_config_editor");
  if (!(editor instanceof HTMLTextAreaElement)) {
    return;
  }
  if (modelRawConfigState.pending) {
    return;
  }

  modelRawConfigState.pending = true;
  setModelRawConfigBusy(true);
  setModelRawConfigStatus("正在读取真实配置文件...", "info");
  try {
    const result = await api("/api/openclaw-config/raw");
    applyModelRawConfigPayload(result);
    if (result.exists === false) {
      setModelRawConfigStatus("配置文件当前不存在，你可以粘贴 JSON 后直接保存创建。", "info");
    } else {
      setModelRawConfigStatus("已与真实配置文件同步。", "ok");
    }
    if (!silent && result.path) {
      setMessage(`已读取真实配置文件：${result.path}`, "ok");
    }
  } catch (error) {
    setModelRawConfigStatus(`读取失败：${error.message || String(error)}`, "error");
    if (!silent) {
      setMessage(error.message || String(error), "error");
    }
  } finally {
    modelRawConfigState.pending = false;
    setModelRawConfigBusy(false);
  }
}

async function saveModelRawConfig() {
  const editor = document.querySelector("#model_raw_config_editor");
  if (!(editor instanceof HTMLTextAreaElement)) {
    return;
  }
  if (modelRawConfigState.pending) {
    setMessage("配置文件正在处理，请稍后重试", "info");
    return;
  }

  const rawText = String(editor.value || "").trim();
  if (!rawText) {
    throw new Error("配置 JSON 不能为空");
  }

  modelRawConfigState.pending = true;
  setModelRawConfigBusy(true);
  setModelRawConfigStatus("正在写入真实配置文件...", "info");
  try {
    const payload = {
      rawText
    };
    if (Number.isFinite(modelRawConfigState.lastSyncMtimeMs) && modelRawConfigState.lastSyncMtimeMs > 0) {
      payload.expectedMtimeMs = modelRawConfigState.lastSyncMtimeMs;
    }
    const result = await api("/api/openclaw-config/raw", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    applyModelRawConfigPayload(result);
    setModelRawConfigStatus("保存成功，已同步真实配置文件。", "ok");
    setMessage(`配置文件写入成功：${result.path}`, "ok");
    const modelSettings = result?.settings?.model;
    if (modelSettings && typeof modelSettings === "object") {
      renderDashboardModelCards(modelSettings);
      fillModelEditor(modelSettings);
    }
  } finally {
    modelRawConfigState.pending = false;
    setModelRawConfigBusy(false);
  }
}

function bindModelRawConfigEditor() {
  if (modelRawConfigState.bound) {
    return;
  }

  const editor = document.querySelector("#model_raw_config_editor");
  if (!(editor instanceof HTMLTextAreaElement)) {
    return;
  }

  modelRawConfigState.bound = true;
  document.querySelector("#model_raw_config_reload")?.addEventListener("click", () => {
    loadModelRawConfig({ silent: false }).catch((error) => {
      setMessage(error.message || String(error), "error");
    });
  });
  document.querySelector("#model_raw_config_save")?.addEventListener("click", () => {
    saveModelRawConfig().catch((error) => {
      setModelRawConfigStatus(`保存失败：${error.message || String(error)}`, "error");
      setMessage(error.message || String(error), "error");
    });
  });
}

async function refreshModelSettingsFromServer(successMessage = "") {
  const result = await api("/api/settings");
  const modelSettings = result?.settings?.model;
  if (!modelSettings || typeof modelSettings !== "object") {
    throw new Error("模型配置刷新失败，请手动刷新页面");
  }
  renderDashboardModelCards(modelSettings);
  fillModelEditor(modelSettings);
  if (successMessage) {
    setMessage(successMessage, "ok");
  }
}

function openProviderEditDialog(providerEntry = {}) {
  const providerId = String(providerEntry?.id || "").trim();
  if (!providerId) {
    setMessage("供应商数据无效，无法编辑", "error");
    return;
  }
  modelMutationState.providerEditId = providerId;
  setInput("model_provider_edit_id", providerId);
  setInput("model_provider_edit_api", String(providerEntry?.api || "").trim());
  setInput("model_provider_edit_baseurl", String(providerEntry?.baseUrl || "").trim());
  setInput("model_provider_edit_apikey", "");
  openShoelaceDialog("model_provider_edit_dialog");
}

async function submitProviderEditDialog() {
  const providerId = String(modelMutationState.providerEditId || "").trim();
  if (!providerId) {
    throw new Error("未找到待编辑的供应商");
  }

  const nextProviderId = String(getInputValue("model_provider_edit_id") || "").trim();
  const nextApi = String(getInputValue("model_provider_edit_api") || "").trim();
  const nextBaseUrl = String(getInputValue("model_provider_edit_baseurl") || "").trim();
  const nextApiKey = String(getInputValue("model_provider_edit_apikey") || "").trim();
  if (!nextProviderId || !nextApi || !nextBaseUrl) {
    throw new Error("请完整填写供应商名称、API 模式和 API 地址");
  }

  const payload = {
    nextProviderId,
    api: nextApi,
    baseUrl: nextBaseUrl
  };
  if (nextApiKey) {
    payload.apiKey = nextApiKey;
  }

  await api(`/api/models/providers/${encodeURIComponent(providerId)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });

  closeShoelaceDialog("model_provider_edit_dialog");
  modelMutationState.providerEditId = "";
  setInput("model_provider_edit_apikey", "");
  const actionText =
    nextProviderId === providerId
      ? `供应商 ${nextProviderId} 已更新`
      : `供应商已从 ${providerId} 更新为 ${nextProviderId}`;
  await refreshModelSettingsFromServer(actionText);
}

function openModelEditDialog(providerEntry = {}, modelEntry = {}) {
  const providerId = String(providerEntry?.id || modelEntry?.providerId || "").trim();
  const modelId = String(modelEntry?.modelId || modelEntry?.id || "").trim();
  if (!providerId || !modelId) {
    setMessage("模型数据无效，无法编辑", "error");
    return;
  }

  modelMutationState.modelEditProviderId = providerId;
  modelMutationState.modelEditId = modelId;
  setInput("model_item_edit_provider", providerId);
  setInput("model_item_edit_id", modelId);
  setInput("model_item_edit_name", String(modelEntry?.modelName || modelEntry?.name || modelId).trim() || modelId);
  setInput("model_item_edit_context_window", modelEntry?.contextWindow || "");
  setInput("model_item_edit_max_tokens", modelEntry?.maxTokens || "");
  openShoelaceDialog("model_item_edit_dialog");
}

async function submitModelEditDialog() {
  const providerId = String(modelMutationState.modelEditProviderId || "").trim();
  const sourceModelId = String(modelMutationState.modelEditId || "").trim();
  if (!providerId || !sourceModelId) {
    throw new Error("未找到待编辑的模型");
  }

  const nextModelId = String(getInputValue("model_item_edit_id") || "").trim();
  const nextModelName = String(getInputValue("model_item_edit_name") || "").trim();
  if (!nextModelId) {
    throw new Error("模型 ID 不能为空");
  }

  const contextWindow = parseOptionalPositiveIntInput(
    getInputValue("model_item_edit_context_window"),
    "模型最大上下文"
  );
  const maxTokens = parseOptionalPositiveIntInput(getInputValue("model_item_edit_max_tokens"), "模型最大输出");

  const payload = {
    nextModelId,
    name: nextModelName || nextModelId
  };
  if (contextWindow !== undefined) {
    payload.contextWindow = contextWindow;
  }
  if (maxTokens !== undefined) {
    payload.maxTokens = maxTokens;
  }

  await api(`/api/models/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(sourceModelId)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });

  closeShoelaceDialog("model_item_edit_dialog");
  modelMutationState.modelEditProviderId = "";
  modelMutationState.modelEditId = "";
  const actionText =
    nextModelId === sourceModelId
      ? `模型 ${providerId}/${nextModelId} 已更新`
      : `模型已从 ${providerId}/${sourceModelId} 更新为 ${providerId}/${nextModelId}`;
  await refreshModelSettingsFromServer(actionText);
}

async function deleteProviderWithConfirm(providerEntry = {}) {
  const providerId = String(providerEntry?.id || "").trim();
  if (!providerId) {
    throw new Error("供应商标识无效");
  }
  const models = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
  const confirmed = window.confirm(`确认删除供应商 ${providerId} 吗？\n将连带删除其下 ${models.length} 个模型。`);
  if (!confirmed) {
    return;
  }

  await api(`/api/models/providers/${encodeURIComponent(providerId)}`, {
    method: "DELETE"
  });
  await refreshModelSettingsFromServer(`供应商 ${providerId} 已删除`);
}

async function deleteModelWithConfirm(providerEntry = {}, modelEntry = {}) {
  const providerId = String(providerEntry?.id || modelEntry?.providerId || "").trim();
  const modelId = String(modelEntry?.modelId || modelEntry?.id || "").trim();
  if (!providerId || !modelId) {
    throw new Error("模型标识无效");
  }
  const confirmed = window.confirm(`确认删除模型 ${providerId}/${modelId} 吗？\n删除后将无法自动恢复。`);
  if (!confirmed) {
    return;
  }

  await api(`/api/models/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`, {
    method: "DELETE"
  });
  await refreshModelSettingsFromServer(`模型 ${providerId}/${modelId} 已删除`);
}

function getProviderEntries(modelSettings) {
  const providers = Array.isArray(modelSettings?.catalog?.providers) ? modelSettings.catalog.providers : [];
  if (providers.length > 0) {
    return providers;
  }

  const fallbackModelId = String(modelSettings?.modelId || "").trim();
  if (!fallbackModelId) {
    return [];
  }

  return [
    {
      id: String(modelSettings?.providerId || "").trim(),
      api: String(modelSettings?.providerApi || "").trim(),
      baseUrl: String(modelSettings?.providerBaseUrl || "").trim(),
      models: [
        {
          id: fallbackModelId,
          name: String(modelSettings?.modelName || fallbackModelId).trim() || fallbackModelId,
          contextWindow: Number(modelSettings?.contextWindow || 0) || undefined,
          maxTokens: Number(modelSettings?.maxTokens || 0) || undefined,
          thinkingStrength: String(modelSettings?.thinkingStrength || "").trim() || "无"
        }
      ]
    }
  ];
}

function setModelProviderMode(mode) {
  const rawMode = String(mode || "").trim();
  const normalizedMode = rawMode === "custom" || rawMode === "existing" ? rawMode : "template";
  modelEditorState.providerMode = normalizedMode;

  const hintByMode = {
    template: "直接添加模型：基于预置模板快速新增。",
    custom: "新增供应商并添加模型：适合第一次接入新服务。",
    existing: "基于已有供应商添加：不会新建供应商。"
  };
  const hintText = hintByMode[normalizedMode] || hintByMode.template;
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

  const providers = getProviderEntries(modelSettings);
  const primaryRef = String(modelSettings?.primary || "").trim();
  const currentRefParts = parseModelRef(primaryRef);
  container.innerHTML = "";

  if (providers.length === 0) {
    const emptyCard = document.createElement("article");
    emptyCard.className = "model-provider-group model-provider-group-empty";

    const emptyBody = document.createElement("div");
    emptyBody.className = "model-provider-empty-body";

    const emptyTitle = document.createElement("p");
    emptyTitle.className = "model-provider-empty-title";
    emptyTitle.textContent = "当前配置没有可用提供商和模型";

    const emptyHint = document.createElement("p");
    emptyHint.className = "model-provider-empty-hint";
    emptyHint.textContent = "你可以先添加一个供应商和模型，然后回到这里管理。";

    const emptyAction = document.createElement("a");
    emptyAction.className = "model-provider-empty-action";
    emptyAction.href = "/model/add";
    emptyAction.textContent = "点击添加";
    emptyAction.setAttribute("aria-label", "点击添加模型");

    emptyBody.appendChild(emptyTitle);
    emptyBody.appendChild(emptyHint);
    emptyBody.appendChild(emptyAction);
    emptyCard.appendChild(emptyBody);
    container.appendChild(emptyCard);
    setInput("dashboard_current_model", "-");
    setInput("dashboard_current_provider", "-");
    setInput("dashboard_current_context_window", "-");
    setInput("dashboard_current_thinking_strength", "无");
    return;
  }

  providers.forEach((providerEntry) => {
    const models = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
    if (models.length === 0) {
      return;
    }

    const group = document.createElement("article");
    group.className = "model-provider-group";
    const providerId = String(providerEntry?.id || "").trim();

    if (providerId) {
      const header = document.createElement("div");
      header.className = "model-provider-group-head";
      const headRow = document.createElement("div");
      headRow.className = "model-provider-group-head-row";
      const title = document.createElement("h3");
      title.className = "model-provider-group-title";
      title.textContent = providerId;
      headRow.appendChild(title);

      const providerActions = document.createElement("div");
      providerActions.className = "model-provider-group-actions";

      const providerEditButton = document.createElement("button");
      providerEditButton.type = "button";
      providerEditButton.className = "model-provider-action-btn";
      providerEditButton.textContent = "编辑供应商";
      providerEditButton.addEventListener("click", () => {
        openProviderEditDialog(providerEntry);
      });
      providerActions.appendChild(providerEditButton);

      const providerDeleteButton = document.createElement("button");
      providerDeleteButton.type = "button";
      providerDeleteButton.className = "model-provider-action-btn model-provider-action-btn-danger";
      providerDeleteButton.textContent = "删除供应商";
      providerDeleteButton.addEventListener("click", () => {
        runModelMutation(async () => {
          await deleteProviderWithConfirm(providerEntry);
        }).catch((error) => {
          setMessage(error.message || String(error), "error");
        });
      });
      providerActions.appendChild(providerDeleteButton);

      headRow.appendChild(providerActions);
      const meta = document.createElement("p");
      meta.className = "model-provider-group-meta";
      meta.textContent = `API: ${providerEntry.api || "-"} | Base URL: ${providerEntry.baseUrl || "-"}`;
      header.appendChild(headRow);
      header.appendChild(meta);
      group.appendChild(header);
    }

    const modelList = document.createElement("div");
    modelList.className = "model-chip-grid";
    models.forEach((providerModel) => {
      const modelEntry = buildModelEntryFromProvider(providerEntry, providerModel);
      const fallbackRef = `${String(providerEntry?.id || "").trim()}/${String(providerModel?.id || "").trim()}`.replace(/^\/+/, "");
      const normalizedRef = String(modelEntry.ref || fallbackRef).trim();
      modelEntry.ref = normalizedRef;
      const hasValidRef = Boolean(modelEntry.ref && String(modelEntry.providerId || "").trim() && String(modelEntry.modelId || "").trim());
      const isCurrent =
        normalizedRef === primaryRef ||
        (String(modelEntry.modelId || "").trim() === String(modelSettings?.modelId || "").trim() &&
          String(modelEntry.providerId || "").trim() === String(modelSettings?.providerId || "").trim());

      const family = resolveModelFamilyKey(modelEntry);
      const card = document.createElement("article");
      card.className = `model-chip family-${family}${isCurrent ? " is-current" : ""}`;
      card.classList.toggle("is-disabled", !hasValidRef);
      card.title = hasValidRef ? "点击卡片编辑模型" : "模型信息不完整，暂不可编辑";
      if (hasValidRef) {
        card.tabIndex = 0;
        card.setAttribute("role", "button");
      }

      const label = document.createElement("span");
      label.className = "model-chip-name";
      label.textContent = String(modelEntry.modelName || modelEntry.modelId || "-").trim() || "-";
      card.appendChild(label);

      const detail = document.createElement("span");
      detail.className = "model-chip-meta";
      const contextText =
        modelEntry.contextWindow && modelEntry.contextWindow > 0
          ? `Context ${Number(modelEntry.contextWindow).toLocaleString()}`
          : "Context -";
      const maxText =
        modelEntry.maxTokens && modelEntry.maxTokens > 0 ? `Max ${Number(modelEntry.maxTokens).toLocaleString()}` : "Max -";
      detail.textContent = `${modelEntry.modelId || "-"} | ${contextText} | ${maxText}`;
      card.appendChild(detail);

      if (isCurrent) {
        const currentTag = document.createElement("span");
        currentTag.className = "model-chip-current";
        currentTag.textContent = "当前使用";
        card.appendChild(currentTag);
      }

      const actionRow = document.createElement("div");
      actionRow.className = "model-chip-actions";

      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "model-chip-action";
      editButton.textContent = "编辑";
      editButton.disabled = !hasValidRef;
      editButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!hasValidRef) {
          return;
        }
        openModelEditDialog(providerEntry, modelEntry);
      });
      actionRow.appendChild(editButton);

      if (!isCurrent) {
        const switchButton = document.createElement("button");
        switchButton.type = "button";
        switchButton.className = "model-chip-action";
        switchButton.textContent = "设为默认";
        switchButton.disabled = !hasValidRef;
        switchButton.addEventListener("click", (event) => {
          event.stopPropagation();
          if (!hasValidRef) {
            return;
          }
          runModelMutation(async () => {
            await switchDefaultModelByEntry(modelSettings, modelEntry);
          }).catch((error) => {
            setMessage(error.message || String(error), "error");
          });
        });
        actionRow.appendChild(switchButton);
      }

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "model-chip-action model-chip-action-danger";
      deleteButton.textContent = "删除";
      deleteButton.disabled = !hasValidRef;
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!hasValidRef) {
          return;
        }
        runModelMutation(async () => {
          await deleteModelWithConfirm(providerEntry, modelEntry);
        }).catch((error) => {
          setMessage(error.message || String(error), "error");
        });
      });
      actionRow.appendChild(deleteButton);

      card.appendChild(actionRow);

      if (hasValidRef) {
        card.addEventListener("click", (event) => {
          if (event.target instanceof HTMLElement && event.target.closest(".model-chip-action")) {
            return;
          }
          openModelEditDialog(providerEntry, modelEntry);
        });
        card.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          if (event.target instanceof HTMLElement && event.target.closest(".model-chip-action")) {
            return;
          }
          event.preventDefault();
          openModelEditDialog(providerEntry, modelEntry);
        });
      }

      modelList.appendChild(card);
    });

    group.appendChild(modelList);
    container.appendChild(group);
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

  // 顶部大字状态同步
  const heroEl = document.querySelector("#runtime_state");
  if (heroEl) {
    heroEl.textContent = runtime?.active ? "机器人运行中" : runtime?.ok === false ? "状态异常" : "未运行";
    const dot = heroEl.previousElementSibling;
    if (dot && dot.classList.contains("dot")) {
      dot.style.background = runtime?.active ? "var(--success, #22c55e)" : "var(--danger, #ef4444)";
    }
  }

  const currentModel = model?.current && typeof model.current === "object" ? model.current : {};
  const modelId = String(currentModel?.modelName || currentModel?.modelId || "-");
  const modelProvider = String(currentModel?.providerId || "-");
  setText("dashboard_summary_model", modelId || "-");
  setText("dashboard_summary_model_meta", `提供商: ${modelProvider}`);
  // 同步 hero 模型名 + 模型切换区显示
  setText("dashboard_hero_model", modelId !== "-" ? `· ${modelId}` : "");
  setText("dashboard_model_display", modelId || "-");

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
    hint.textContent = refreshedAt ? `最后刷新：${refreshedAt}` : '点击"刷新总览"后显示最新状态。';
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
    const node = document.createElement("sl-card");
    node.className = "dashboard-runtime-item dashboard-runtime-item-channel";
    node.title = `${item?.name || item?.key || "未命名 Skill"}\nkey: ${item?.key || "-"}\nsource: ${item?.source || "-"}`;

    const body = document.createElement("div");
    body.className = "dashboard-runtime-item-body";

    const top = document.createElement("div");
    top.className = "stack-item-row";
    const title = document.createElement("span");
    title.className = "stack-item-title";
    title.textContent = item?.label || item?.id || "未命名渠道";
    top.appendChild(title);

    const chips = document.createElement("div");
    chips.className = "chip-line";

    const configuredChip = createDashboardStatusTag(item?.configured ? "已配置" : "未配置", item?.configured ? "success" : "neutral");
    chips.appendChild(configuredChip);

    const runningChip = createDashboardStatusTag(item?.running ? "运行中" : "未运行", item?.running ? "primary" : "warning");
    chips.appendChild(runningChip);

    if (String(item?.lastError || "").trim()) {
      chips.appendChild(createDashboardStatusTag("最近有报错", "danger"));
    }

    top.appendChild(chips);
    body.appendChild(top);

    const meta = document.createElement("p");
    meta.className = "stack-item-meta";
    const errorText = String(item?.lastError || "").trim();
    const probeText = formatLocalTime(item?.lastProbeAt);
    meta.textContent = errorText ? `最近错误: ${errorText}` : `最近检查: ${probeText}`;
    body.appendChild(meta);
    node.appendChild(body);
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

  const total = items.length;
  const enabledCount = items.filter((i) => i?.enabled).length;

  // 摘要文字
  const summaryEl = document.querySelector("#dashboard_skills_summary_text");
  if (summaryEl) {
    summaryEl.textContent = `${total} 个技能，${enabledCount} 个已启用`;
  }

  // 分为有问题 / 正常两组
  const problemItems = items.filter((i) => !i?.enabled || i?.blocked || !i?.eligible);
  const normalItems = items.filter((i) => i?.enabled && !i?.blocked && i?.eligible);

  container.innerHTML = "";

  const renderItem = (item) => {
    const node = document.createElement("div");
    node.className = "dashboard-runtime-item-flat dashboard-runtime-item-body";

    const top = document.createElement("div");
    top.className = "stack-item-row";
    const title = document.createElement("span");
    title.className = "stack-item-title";
    title.textContent = item?.name || item?.key || "未命名 Skill";
    top.appendChild(title);

    const chips = document.createElement("div");
    chips.className = "chip-line";
    // 三维状态合并为一个标签
    let statusText, statusVariant;
    if (item?.blocked) {
      statusText = "受限"; statusVariant = "danger";
    } else if (!item?.enabled) {
      statusText = "已禁用"; statusVariant = "neutral";
    } else if (!item?.eligible) {
      statusText = "未就绪"; statusVariant = "warning";
    } else {
      statusText = "正常"; statusVariant = "success";
    }
    chips.appendChild(createDashboardStatusTag(statusText, statusVariant));
    top.appendChild(chips);
    node.appendChild(top);
    return node;
  };

  // 先渲染有问题的
  problemItems.forEach((item) => container.appendChild(renderItem(item)));

  // 正常技能默认隐藏
  const normalNodes = normalItems.map((item) => {
    const n = renderItem(item);
    n.style.display = "none";
    n.dataset.skillNormal = "1";
    container.appendChild(n);
    return n;
  });

  // 切换按钮
  const toggleBtn = document.querySelector("#dashboard_skills_toggle_all");
  if (toggleBtn) {
    if (normalItems.length === 0) {
      toggleBtn.style.display = "none";
    } else {
      toggleBtn.style.display = "";
      toggleBtn.textContent = `显示全部 (${total})`;
      let expanded = false;
      toggleBtn.onclick = () => {
        expanded = !expanded;
        normalNodes.forEach((n) => (n.style.display = expanded ? "" : "none"));
        toggleBtn.textContent = expanded ? "只看有问题的" : `显示全部 (${total})`;
      };
    }
  }
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

function getCatalogProviders(modelSettings = modelEditorState.currentModelSettings) {
  return Array.isArray(modelSettings?.catalog?.providers) ? modelSettings.catalog.providers : [];
}

function findCatalogProviderById(providerId, modelSettings = modelEditorState.currentModelSettings) {
  const target = String(providerId || "").trim();
  if (!target) {
    return null;
  }
  return getCatalogProviders(modelSettings).find((provider) => String(provider?.id || "").trim() === target) || null;
}

function syncExistingProviderMeta(modelSettings = modelEditorState.currentModelSettings) {
  const selectedProviderId = String(getInputValue("existing_provider_id") || "").trim();
  const selectedProvider = findCatalogProviderById(selectedProviderId, modelSettings);
  setInput("existing_provider_api", selectedProvider?.api || "");
  setInput("existing_provider_baseurl", selectedProvider?.baseUrl || "");
}

function fillExistingProviderOptions(modelSettings) {
  const select = document.querySelector("#existing_provider_id");
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }

  const providers = getCatalogProviders(modelSettings).filter((provider) => String(provider?.id || "").trim());
  select.innerHTML = "";
  if (providers.length === 0) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "暂无可用供应商";
    select.appendChild(emptyOption);
    select.disabled = true;
    setInput("existing_provider_api", "");
    setInput("existing_provider_baseurl", "");
    return;
  }

  select.disabled = false;
  providers.forEach((provider) => {
    const option = document.createElement("option");
    option.value = String(provider.id || "").trim();
    option.textContent = String(provider.id || "").trim();
    select.appendChild(option);
  });

  const preferredProviderId = String(modelSettings?.providerId || "").trim();
  if (preferredProviderId && providers.some((provider) => String(provider.id || "").trim() === preferredProviderId)) {
    select.value = preferredProviderId;
  } else if (select.options.length > 0) {
    select.selectedIndex = 0;
  }
  syncExistingProviderMeta(modelSettings);
}

function fillModelEditor(modelSettings) {
  const catalog = modelSettings?.catalog || { providers: [], modelRefs: [] };
  const catalogRefs = Array.isArray(catalog.modelRefs) ? catalog.modelRefs : [];
  modelEditorState.currentModelSettings = modelSettings || null;
  modelEditorState.modelCatalog = {
    providers: Array.isArray(catalog.providers) ? catalog.providers : [],
    modelRefs: catalogRefs
  };

  const selectableModelRefs = [];
  const seenRefs = new Set();

  // 只使用当前配置文件中已经存在的模型，避免把模板默认模型误展示给用户。
  catalogRefs.forEach((entry) => {
    const ref = String(entry?.ref || "").trim();
    if (!ref || seenRefs.has(ref)) {
      return;
    }
    seenRefs.add(ref);
    selectableModelRefs.push({
      ...entry,
      ref
    });
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
  setInput("existing_set_as_primary", false);
  setInput("custom_set_as_primary", false);
  fillExistingProviderOptions(modelSettings);
  setModelProviderMode("template");
  setModelAddWorkspaceVisible(false);

  fillDashboardQuickSwitch(modelSettings);

  if (document.querySelector("#model_raw_config_editor")) {
    loadModelRawConfig({ silent: true }).catch((error) => {
      setModelRawConfigStatus(`读取失败：${error.message || String(error)}`, "error");
    });
  }
}

function bindModelCrudDialogEvents() {
  if (modelMutationState.dialogBound) {
    return;
  }
  modelMutationState.dialogBound = true;

  document.querySelector("#model_provider_edit_cancel")?.addEventListener("click", () => {
    closeShoelaceDialog("model_provider_edit_dialog");
  });
  document.querySelector("#model_provider_edit_submit")?.addEventListener("click", () => {
    runModelMutation(async () => {
      await submitProviderEditDialog();
    }).catch((error) => {
      setMessage(error.message || String(error), "error");
    });
  });

  document.querySelector("#model_item_edit_cancel")?.addEventListener("click", () => {
    closeShoelaceDialog("model_item_edit_dialog");
  });
  document.querySelector("#model_item_edit_submit")?.addEventListener("click", () => {
    runModelMutation(async () => {
      await submitModelEditDialog();
    }).catch((error) => {
      setMessage(error.message || String(error), "error");
    });
  });

  const providerDialog = getShoelaceDialog("model_provider_edit_dialog");
  providerDialog?.addEventListener("sl-after-hide", () => {
    modelMutationState.providerEditId = "";
    setInput("model_provider_edit_apikey", "");
  });

  const modelDialog = getShoelaceDialog("model_item_edit_dialog");
  modelDialog?.addEventListener("sl-after-hide", () => {
    modelMutationState.modelEditProviderId = "";
    modelMutationState.modelEditId = "";
  });
}

function setupModelEditor() {
  const panel = document.querySelector('[data-panel="panel-model"], [data-panel="panel-model-add"]');
  if (!panel || panel.dataset.boundModelEditor === "1") {
    return;
  }
  panel.dataset.boundModelEditor = "1";
  bindModelCrudDialogEvents();
  bindModelRawConfigEditor();
  const defaultSelect = document.querySelector("#model_default_ref");

  document.querySelector("#model_add_toggle")?.addEventListener("click", () => {
    const workspace = document.querySelector("#model_add_workspace");
    const willOpen = workspace ? workspace.classList.contains("is-hidden") : false;
    setModelAddWorkspaceVisible(willOpen);
    if (willOpen) {
      setModelProviderMode(modelEditorState.providerMode || "template");
      workspace?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  document.querySelectorAll("[data-model-provider-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetMode = String(button.getAttribute("data-model-provider-mode") || "").trim();
      setModelProviderMode(targetMode);
    });
  });
  setModelProviderMode(modelEditorState.providerMode || "template");
  document.querySelector("#existing_provider_id")?.addEventListener("change", () => {
    syncExistingProviderMeta(modelEditorState.currentModelSettings);
  });

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

  if (defaultSelect instanceof HTMLSelectElement) {
    defaultSelect.addEventListener("change", () => {
      const selectedRef = String(defaultSelect.value || "");
      const entry = modelEditorState.defaultModelRefs.find((item) => item.ref === selectedRef);
      renderModelSummary(entry || {}, selectedRef);
    });
  }

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

  document.querySelector("#save_provider_existing")?.addEventListener("click", () => {
    const providerId = String(getInputValue("existing_provider_id") || "").trim();
    const providerEntry = findCatalogProviderById(providerId, modelEditorState.currentModelSettings);
    if (!providerEntry) {
      setMessage("请先选择一个已有供应商", "error");
      return;
    }

    const modelId = String(getInputValue("existing_model_id") || "").trim();
    const modelNameInput = String(getInputValue("existing_model_name") || "").trim();
    const contextWindowInput = Number(getInputValue("existing_model_context_window") || 0);
    const maxTokensInput = Number(getInputValue("existing_model_max_tokens") || 0);
    if (!modelId) {
      setMessage("请填写模型 ID", "error");
      return;
    }

    const providerApi = String(providerEntry.api || "").trim();
    const providerBaseUrl = String(providerEntry.baseUrl || "").trim();
    if (!providerApi || !providerBaseUrl) {
      setMessage("该供应商缺少 API 或 Base URL，请先补齐供应商配置后再添加模型", "error");
      return;
    }

    const currentModels = Array.isArray(providerEntry.models) ? providerEntry.models : [];
    const fallbackModel =
      currentModels.find((item) => String(item?.id || "").trim() === modelId) ||
      buildDefaultModelEntry(modelId, modelNameInput || modelId) ||
      {};
    const nextModel = normalizeModelDraft(
      {
        id: modelId,
        name: modelNameInput || modelId,
        contextWindow: Number.isFinite(contextWindowInput) && contextWindowInput > 0 ? Math.floor(contextWindowInput) : undefined,
        maxTokens: Number.isFinite(maxTokensInput) && maxTokensInput > 0 ? Math.floor(maxTokensInput) : undefined
      },
      fallbackModel
    );
    if (!nextModel) {
      setMessage("模型信息无效，请检查模型 ID", "error");
      return;
    }

    const mergedModels = [nextModel];
    currentModels.forEach((item) => {
      const existingId = String(item?.id || "").trim();
      if (!existingId || existingId === nextModel.id) {
        return;
      }
      mergedModels.push(item);
    });

    const targetPrimaryRef = `${providerId}/${nextModel.id}`;
    const primaryRef = resolveProviderSavePrimaryRef(targetPrimaryRef, "existing_set_as_primary");
    if (!primaryRef) {
      setMessage("无法确定默认模型指向，请先设置默认模型或勾选“保存后设为当前默认模型”", "error");
      return;
    }

    const payload = buildModelPayload({
      primary: primaryRef,
      providerId,
      providerApi,
      providerBaseUrl,
      providerApiKey: "",
      modelId: nextModel.id,
      modelName: nextModel.name || nextModel.id,
      contextWindow: nextModel.contextWindow,
      maxTokens: nextModel.maxTokens,
      providerModels: mergedModels
    });
    const shouldSwitchPrimary = Boolean(getInputValue("existing_set_as_primary"));
    const actionLabel = shouldSwitchPrimary
      ? `已在供应商 ${providerId} 下新增模型并切换默认`
      : `已在供应商 ${providerId} 下新增模型（默认模型未变）`;
    saveModelSettings(payload, actionLabel)
      .then(() => {
        setInput("existing_model_id", "");
        setInput("existing_model_name", "");
        setInput("existing_model_context_window", "");
        setInput("existing_model_max_tokens", "");
        setInput("existing_set_as_primary", false);
      })
      .catch((error) => setMessage(error.message, "error"));
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
  setModelAddWorkspaceVisible(false);
}


let saveModelSettingsHandler = null;

function setSaveModelSettingsHandler(handler) {
  saveModelSettingsHandler = typeof handler === "function" ? handler : null;
}

async function saveModelSettings(...args) {
  if (!saveModelSettingsHandler) {
    throw new Error("saveModelSettings handler 未设置");
  }
  return saveModelSettingsHandler(...args);
}

export {
  fillModelEditor,
  fillDashboardQuickSwitch,
  loadStatusOverview,
  renderDashboardModelCards,
  renderModelSummary,
  setupDashboard,
  setupModelEditor,
  setSaveModelSettingsHandler,
  updateDashboardErrorSummary,
  updateDashboardVersionSummary
};
