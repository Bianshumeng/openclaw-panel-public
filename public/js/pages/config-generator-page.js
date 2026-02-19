import {
  AICODECAT_PROVIDER,
  DEFAULT_MODEL_OPTIONS,
  MODEL_PROFILE_BY_FAMILY,
  fillDefaultModelOptions,
  modelFamilyById,
  setMessage
} from "../core/panel-core.js";
import { apiModeFamily, convertConfig, resolveAicodecatBaseUrl } from "../../config-generator.js";

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
  const apiKeyToggleEl = document.querySelector("#cfg_apikey_toggle");
  const contextWindowEl = document.querySelector("#cfg_context_window");
  const maxTokensEl = document.querySelector("#cfg_max_tokens");
  const reasoningEl = document.querySelector("#cfg_reasoning");
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
    !contextWindowEl ||
    !maxTokensEl ||
    !reasoningEl ||
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
    claude:
      DEFAULT_MODEL_OPTIONS.find((item) => modelFamilyById(item.id) === "claude")?.id ||
      "claude-sonnet-4-5-20250929",
    gemini:
      DEFAULT_MODEL_OPTIONS.find((item) => modelFamilyById(item.id) === "gemini")?.id || "gemini-3-pro-preview"
  };
  const reasoningByFamily = {
    gpt: true,
    claude: true,
    gemini: false
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

  const toPositiveInt = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.floor(parsed);
  };

  const resolveFamilyForDefaults = () => {
    const modelId = getFieldValue(modelIdEl, modelIdCustomEl);
    if (modelId) {
      return modelFamilyById(modelId);
    }
    return apiModeFamily(getFieldValue(apiModeEl, apiModeCustomEl));
  };

  const applyModelAdvancedDefaults = (force = false) => {
    const family = resolveFamilyForDefaults();
    const profile = MODEL_PROFILE_BY_FAMILY[family] || MODEL_PROFILE_BY_FAMILY.gpt;
    if (force || !String(contextWindowEl.value || "").trim()) {
      contextWindowEl.value = String(profile?.contextWindow || 200000);
    }
    if (force || !String(maxTokensEl.value || "").trim()) {
      maxTokensEl.value = String(profile?.maxTokens || 8192);
    }
    if (force) {
      reasoningEl.checked = Boolean(reasoningByFamily[family]);
    }
  };

  const setStatus = (text) => {
    statusEl.value = text;
    const isFail = text === "失败";
    const isDone = text === "完成";
    const isWorking = text === "处理中";
    statusEl.classList.toggle("is-fail", isFail);
    statusEl.classList.toggle("is-done", isDone);
    statusEl.classList.toggle("is-working", isWorking);
  };

  const setOutputText = (text, type = "info") => {
    outputEl.textContent = text;
    outputEl.classList.toggle("is-error", type === "error");
  };

  const syncApiKeyVisibility = () => {
    if (!apiKeyToggleEl) {
      return;
    }
    const isVisible = apiKeyEl.type === "text";
    apiKeyToggleEl.textContent = "👁";
    apiKeyToggleEl.classList.toggle("is-visible", isVisible);
    apiKeyToggleEl.setAttribute("aria-pressed", isVisible ? "true" : "false");
    apiKeyToggleEl.setAttribute("aria-label", isVisible ? "隐藏 API 密钥" : "显示 API 密钥");
    apiKeyToggleEl.setAttribute("title", isVisible ? "隐藏 API 密钥" : "显示 API 密钥");
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
    applyModelAdvancedDefaults(true);
  };

  [providerEl, apiModeEl, baseUrlEl, modelIdEl].forEach((selectEl) => {
    const customEl = document.querySelector(`#${selectEl.id}_custom`);
    selectEl.addEventListener("change", () => {
      updateCustomFieldVisibility(selectEl, customEl);
      if (selectEl === providerEl || selectEl === apiModeEl) {
        syncBaseUrlAndModelForAicodecat();
      } else if (selectEl === modelIdEl) {
        applyModelAdvancedDefaults(true);
      }
    });
    updateCustomFieldVisibility(selectEl, customEl);
  });

  apiKeyToggleEl?.addEventListener("click", () => {
    const shouldShow = apiKeyEl.type === "password";
    apiKeyEl.type = shouldShow ? "text" : "password";
    syncApiKeyVisibility();
    apiKeyEl.focus({ preventScroll: true });
  });
  syncApiKeyVisibility();

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
    const contextWindow = toPositiveInt(contextWindowEl.value);
    const maxTokens = toPositiveInt(maxTokensEl.value);
    const payload = {
      config: String(configInputEl.value || "").trim(),
      baseurl: getFieldValue(baseUrlEl, baseUrlCustomEl),
      apikey: String(apiKeyEl.value || "").trim(),
      apimode: getFieldValue(apiModeEl, apiModeCustomEl),
      provider: getFieldValue(providerEl, providerCustomEl),
      model_id: getFieldValue(modelIdEl, modelIdCustomEl),
      context_window: contextWindow,
      max_tokens: maxTokens,
      reasoning: Boolean(reasoningEl.checked),
      inherit_existing: String(inheritExistingEl.value || "").trim() === "true"
    };

    if (!payload.config) {
      setOutputText("错误: 请输入原始 Config JSON", "error");
      setStatus("失败");
      return;
    }
    if (!payload.baseurl) {
      setOutputText("错误: 请选择或输入 Base URL", "error");
      setStatus("失败");
      return;
    }
    if (!payload.apikey) {
      setOutputText("错误: 请输入 API Key", "error");
      setStatus("失败");
      return;
    }
    if (!payload.provider || !payload.apimode || !payload.model_id) {
      setOutputText("错误: provider / apimode / model_id 不能为空", "error");
      setStatus("失败");
      return;
    }
    if (payload.context_window === null) {
      setOutputText("错误: 请填写有效的模型最大上下文（正整数）", "error");
      setStatus("失败");
      return;
    }
    if (payload.max_tokens === null) {
      setOutputText("错误: 请填写有效的最大输出内容（正整数）", "error");
      setStatus("失败");
      return;
    }

    setStatus("处理中");
    try {
      const result = convertConfig(payload);
      setOutputText(JSON.stringify(result, null, 2), "ok");
      setStatus("完成");
      setMessage("配置生成完成（仅前端本地转换）", "ok");
    } catch (error) {
      setOutputText(`错误: ${error.message || String(error)}`, "error");
      setStatus("失败");
      setMessage(`配置生成失败：${error.message || String(error)}`, "error");
    }
  });

  syncBaseUrlAndModelForAicodecat();
  applyModelAdvancedDefaults(false);
}

export { setupConfigGenerator };
