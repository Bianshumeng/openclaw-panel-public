const AICODECAT_PROVIDER = "aicodecat";

const AICODECAT_BASE_URL_BY_MODE = Object.freeze({
  gpt: "https://aicode.cat/v1",
  claude: "https://aicode.cat",
  gemini: "https://aicode.cat/v1beta"
});

const API_MODE_TO_FAMILY = Object.freeze({
  "openai-responses": "gpt",
  "openai-completions": "gpt",
  "anthropic-messages": "claude",
  "google-generative-ai": "gemini"
});

function toTrimmedString(value) {
  return String(value ?? "").trim();
}

function toBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  return toTrimmedString(value).toLowerCase() === "true";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function apiModeFamily(apiMode) {
  return API_MODE_TO_FAMILY[toTrimmedString(apiMode)] || "gpt";
}

export function resolveAicodecatBaseUrl(apiMode) {
  return AICODECAT_BASE_URL_BY_MODE[apiModeFamily(apiMode)];
}

export function resolveProviderId(provider, apiMode) {
  const providerValue = toTrimmedString(provider);
  if (providerValue !== AICODECAT_PROVIDER) {
    return providerValue;
  }

  const family = apiModeFamily(apiMode);
  if (family === "claude") {
    return "aicodecat-claude";
  }
  if (family === "gemini") {
    return "aicodecat-gemini";
  }
  return "aicodecat-gpt";
}

export function convertConfig(payload) {
  let userConfig;
  try {
    userConfig = JSON.parse(toTrimmedString(payload.config));
  } catch (error) {
    throw new Error(`配置 JSON 格式错误: ${error.message}`);
  }

  const provider = toTrimmedString(payload.provider);
  const providerId = resolveProviderId(provider, payload.apimode);
  const modelId = toTrimmedString(payload.model_id);
  const inheritExisting = toBoolean(payload.inherit_existing);
  const sourceConfig = isRecord(userConfig) ? userConfig : {};
  const existingAgents = isRecord(sourceConfig.agents) ? sourceConfig.agents : {};
  const existingDefaults = isRecord(existingAgents.defaults) ? existingAgents.defaults : {};
  const existingDefaultModel = isRecord(existingDefaults.model) ? existingDefaults.model : {};

  const agents = inheritExisting
    ? {
        ...existingAgents,
        defaults: {
          ...existingDefaults,
          model: {
            ...existingDefaultModel,
            primary: `${providerId}/${modelId}`
          }
        }
      }
    : {
        defaults: {
          model: {
            primary: `${providerId}/${modelId}`
          }
        }
      };

  const result = {
    ...(inheritExisting ? sourceConfig : {}),
    models: {
      mode: "merge",
      providers: {
        [providerId]: {
          baseUrl: toTrimmedString(payload.baseurl),
          apiKey: toTrimmedString(payload.apikey),
          api: toTrimmedString(payload.apimode),
          models: [
            {
              id: modelId,
              name: modelId
            }
          ]
        }
      }
    },
    agents
  };

  delete result.auth;
  return result;
}

export { AICODECAT_PROVIDER };
