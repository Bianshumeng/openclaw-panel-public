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

const MODEL_DEFAULTS_BY_FAMILY = Object.freeze({
  gpt: {
    contextWindow: 400000,
    maxTokens: 128000,
    reasoning: true
  },
  claude: {
    contextWindow: 200000,
    maxTokens: 64000,
    reasoning: true
  },
  gemini: {
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoning: false
  }
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

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
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
  const modelFamily = apiModeFamily(payload.apimode);
  const modelDefaults = MODEL_DEFAULTS_BY_FAMILY[modelFamily] || MODEL_DEFAULTS_BY_FAMILY.gpt;
  const modelRef = `${providerId}/${modelId}`;
  const modelContextWindow = toPositiveInt(payload.context_window, modelDefaults.contextWindow);
  const modelMaxTokens = toPositiveInt(payload.max_tokens, modelDefaults.maxTokens);
  const modelReasoning = payload.reasoning === undefined ? modelDefaults.reasoning : toBoolean(payload.reasoning);
  const inheritExisting = toBoolean(payload.inherit_existing);
  const sourceConfig = isRecord(userConfig) ? userConfig : {};
  const existingAgents = isRecord(sourceConfig.agents) ? sourceConfig.agents : {};
  const existingDefaults = isRecord(existingAgents.defaults) ? existingAgents.defaults : {};
  const existingDefaultModel = isRecord(existingDefaults.model) ? existingDefaults.model : {};
  const existingDefaultModels = isRecord(existingDefaults.models) ? existingDefaults.models : {};
  const existingGateway = isRecord(sourceConfig.gateway) ? sourceConfig.gateway : {};
  const defaultModels = inheritExisting ? { ...existingDefaultModels } : {};
  if (!isRecord(defaultModels[modelRef])) {
    defaultModels[modelRef] = {};
  }

  const agents = inheritExisting
    ? {
        ...existingAgents,
        defaults: {
          ...existingDefaults,
          model: {
            ...existingDefaultModel,
            primary: modelRef
          },
          models: defaultModels
        }
      }
    : {
        defaults: {
          model: {
            primary: modelRef
          },
          models: defaultModels
        }
      };

  const result = {
    ...(inheritExisting ? sourceConfig : {}),
    gateway: {
      ...(inheritExisting ? existingGateway : {}),
      mode: toTrimmedString(existingGateway.mode) || "local"
    },
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
              name: modelId,
              reasoning: modelReasoning,
              contextWindow: modelContextWindow,
              maxTokens: modelMaxTokens
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
