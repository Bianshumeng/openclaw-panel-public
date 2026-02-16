import {
  AICODECAT_PROVIDER,
  DEFAULT_MODEL_OPTIONS,
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
    claude:
      DEFAULT_MODEL_OPTIONS.find((item) => modelFamilyById(item.id) === "claude")?.id ||
      "claude-sonnet-4-5-20250929",
    gemini:
      DEFAULT_MODEL_OPTIONS.find((item) => modelFamilyById(item.id) === "gemini")?.id || "gemini-3-pro-preview"
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

export { setupConfigGenerator };
