function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeRef(providerId, modelId) {
  const cleanProviderId = String(providerId || "").trim();
  const cleanModelId = String(modelId || "").trim();
  if (!cleanProviderId || !cleanModelId) {
    return "";
  }
  return `${cleanProviderId}/${cleanModelId}`;
}

function ensureCatalogConfig(currentConfig) {
  const next = structuredClone(currentConfig || {});

  if (!isRecord(next.models)) {
    next.models = {};
  }
  if (!isRecord(next.models.providers)) {
    next.models.providers = {};
  }
  if (!isRecord(next.agents)) {
    next.agents = {};
  }
  if (!isRecord(next.agents.defaults)) {
    next.agents.defaults = {};
  }
  if (!isRecord(next.agents.defaults.model)) {
    next.agents.defaults.model = {};
  }
  if (!isRecord(next.agents.defaults.models)) {
    next.agents.defaults.models = {};
  }

  return next;
}

function collectModelRefs(providers) {
  const refs = [];
  Object.entries(providers || {}).forEach(([providerId, providerEntry]) => {
    const models = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
    models.forEach((modelEntry) => {
      const modelId = String(modelEntry?.id || "").trim();
      const ref = normalizeRef(providerId, modelId);
      if (ref) {
        refs.push(ref);
      }
    });
  });
  return refs;
}

function resolveFallbackPrimary(providers) {
  for (const [providerId, providerEntry] of Object.entries(providers || {})) {
    const models = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
    for (const modelEntry of models) {
      const modelId = String(modelEntry?.id || "").trim();
      const ref = normalizeRef(providerId, modelId);
      if (ref) {
        return ref;
      }
    }
  }
  return "";
}

function remapModelOverrides(nextConfig, remap) {
  const currentOverrides = isRecord(nextConfig?.agents?.defaults?.models) ? nextConfig.agents.defaults.models : {};
  const mappedOverrides = {};
  Object.entries(currentOverrides).forEach(([ref, value]) => {
    const mappedRef = String(remap(ref) || "").trim();
    if (!mappedRef) {
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(mappedOverrides, mappedRef)) {
      mappedOverrides[mappedRef] = value;
    }
  });
  nextConfig.agents.defaults.models = mappedOverrides;
}

function normalizePrimaryAndOverrides(nextConfig) {
  const providers = isRecord(nextConfig?.models?.providers) ? nextConfig.models.providers : {};
  const validRefs = new Set(collectModelRefs(providers));

  const currentPrimary = String(nextConfig?.agents?.defaults?.model?.primary || "").trim();
  const normalizedPrimary = validRefs.has(currentPrimary) ? currentPrimary : resolveFallbackPrimary(providers);
  nextConfig.agents.defaults.model.primary = normalizedPrimary;

  const currentOverrides = isRecord(nextConfig?.agents?.defaults?.models) ? nextConfig.agents.defaults.models : {};
  const filteredOverrides = {};
  Object.entries(currentOverrides).forEach(([ref, value]) => {
    if (validRefs.has(ref)) {
      filteredOverrides[ref] = value;
    }
  });
  nextConfig.agents.defaults.models = filteredOverrides;

  return {
    primary: normalizedPrimary,
    availableModelRefs: [...validRefs]
  };
}

function readOptionalPositiveInt(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} 必须是正整数`);
  }
  return Math.floor(parsed);
}

function updateProviderInCatalog(currentConfig, payload = {}) {
  const sourceProviderId = String(payload.providerId || "").trim();
  const targetProviderId = String(payload.nextProviderId || sourceProviderId).trim();
  const nextApi = String(payload.api || "").trim();
  const nextBaseUrl = String(payload.baseUrl || "").trim();

  if (!sourceProviderId) {
    throw new Error("providerId 不能为空");
  }
  if (!targetProviderId) {
    throw new Error("nextProviderId 不能为空");
  }
  if (!nextApi) {
    throw new Error("供应商 API 模式不能为空");
  }
  if (!nextBaseUrl) {
    throw new Error("供应商 Base URL 不能为空");
  }

  const nextConfig = ensureCatalogConfig(currentConfig);
  const providers = nextConfig.models.providers;
  const sourceProvider = providers[sourceProviderId];
  if (!isRecord(sourceProvider)) {
    throw new Error(`供应商不存在：${sourceProviderId}`);
  }

  if (targetProviderId !== sourceProviderId && isRecord(providers[targetProviderId])) {
    throw new Error(`供应商名称已存在：${targetProviderId}`);
  }

  const updatedProvider = {
    ...sourceProvider,
    api: nextApi,
    baseUrl: nextBaseUrl
  };

  if (Object.prototype.hasOwnProperty.call(payload, "apiKey")) {
    updatedProvider.apiKey = String(payload.apiKey || "").trim();
  }

  if (targetProviderId !== sourceProviderId) {
    delete providers[sourceProviderId];
  }
  providers[targetProviderId] = updatedProvider;

  if (targetProviderId !== sourceProviderId) {
    const sourcePrefix = `${sourceProviderId}/`;
    const targetPrefix = `${targetProviderId}/`;
    const currentPrimary = String(nextConfig.agents.defaults.model.primary || "").trim();
    if (currentPrimary.startsWith(sourcePrefix)) {
      nextConfig.agents.defaults.model.primary = `${targetPrefix}${currentPrimary.slice(sourcePrefix.length)}`;
    }
    remapModelOverrides(nextConfig, (ref) =>
      ref.startsWith(sourcePrefix) ? `${targetPrefix}${ref.slice(sourcePrefix.length)}` : ref
    );
  }

  const normalized = normalizePrimaryAndOverrides(nextConfig);
  return {
    nextConfig,
    providerId: targetProviderId,
    primary: normalized.primary
  };
}

function updateModelInCatalog(currentConfig, payload = {}) {
  const providerId = String(payload.providerId || "").trim();
  const sourceModelId = String(payload.modelId || "").trim();
  const targetModelId = String(payload.nextModelId || sourceModelId).trim();

  if (!providerId) {
    throw new Error("providerId 不能为空");
  }
  if (!sourceModelId) {
    throw new Error("modelId 不能为空");
  }
  if (!targetModelId) {
    throw new Error("nextModelId 不能为空");
  }

  const nextConfig = ensureCatalogConfig(currentConfig);
  const providers = nextConfig.models.providers;
  const provider = providers[providerId];
  if (!isRecord(provider)) {
    throw new Error(`供应商不存在：${providerId}`);
  }

  const models = Array.isArray(provider.models) ? [...provider.models] : [];
  const sourceIndex = models.findIndex((modelEntry) => String(modelEntry?.id || "").trim() === sourceModelId);
  if (sourceIndex < 0) {
    throw new Error(`模型不存在：${providerId}/${sourceModelId}`);
  }

  if (
    targetModelId !== sourceModelId &&
    models.some((modelEntry, index) => index !== sourceIndex && String(modelEntry?.id || "").trim() === targetModelId)
  ) {
    throw new Error(`模型 ID 已存在：${providerId}/${targetModelId}`);
  }

  const currentModel = isRecord(models[sourceIndex]) ? models[sourceIndex] : {};
  const nextModel = {
    ...currentModel,
    id: targetModelId
  };

  if (Object.prototype.hasOwnProperty.call(payload, "name")) {
    const nextName = String(payload.name || "").trim();
    nextModel.name = nextName || targetModelId;
  } else if (!String(nextModel.name || "").trim()) {
    nextModel.name = targetModelId;
  }

  const nextContextWindow = readOptionalPositiveInt(payload.contextWindow, "contextWindow");
  if (nextContextWindow !== undefined) {
    nextModel.contextWindow = nextContextWindow;
  }

  const nextMaxTokens = readOptionalPositiveInt(payload.maxTokens, "maxTokens");
  if (nextMaxTokens !== undefined) {
    nextModel.maxTokens = nextMaxTokens;
  }

  models[sourceIndex] = nextModel;
  provider.models = models;

  if (targetModelId !== sourceModelId) {
    const sourceRef = normalizeRef(providerId, sourceModelId);
    const targetRef = normalizeRef(providerId, targetModelId);
    if (!targetRef) {
      throw new Error("模型引用无效");
    }
    if (String(nextConfig.agents.defaults.model.primary || "").trim() === sourceRef) {
      nextConfig.agents.defaults.model.primary = targetRef;
    }
    remapModelOverrides(nextConfig, (ref) => (ref === sourceRef ? targetRef : ref));
  }

  const normalized = normalizePrimaryAndOverrides(nextConfig);
  return {
    nextConfig,
    providerId,
    modelId: targetModelId,
    modelName: String(nextModel.name || targetModelId).trim() || targetModelId,
    primary: normalized.primary
  };
}

function removeProviderFromCatalog(currentConfig, payload = {}) {
  const providerId = String(payload.providerId || "").trim();
  if (!providerId) {
    throw new Error("providerId 不能为空");
  }

  const nextConfig = ensureCatalogConfig(currentConfig);
  const providers = nextConfig.models.providers;
  if (!isRecord(providers[providerId])) {
    throw new Error(`供应商不存在：${providerId}`);
  }

  delete providers[providerId];

  const providerPrefix = `${providerId}/`;
  const currentPrimary = String(nextConfig.agents.defaults.model.primary || "").trim();
  if (currentPrimary.startsWith(providerPrefix)) {
    nextConfig.agents.defaults.model.primary = "";
  }
  remapModelOverrides(nextConfig, (ref) => (ref.startsWith(providerPrefix) ? "" : ref));

  const normalized = normalizePrimaryAndOverrides(nextConfig);
  return {
    nextConfig,
    providerId,
    primary: normalized.primary
  };
}

function removeModelFromCatalog(currentConfig, payload = {}) {
  const providerId = String(payload.providerId || "").trim();
  const modelId = String(payload.modelId || "").trim();

  if (!providerId) {
    throw new Error("providerId 不能为空");
  }
  if (!modelId) {
    throw new Error("modelId 不能为空");
  }

  const nextConfig = ensureCatalogConfig(currentConfig);
  const providers = nextConfig.models.providers;
  const provider = providers[providerId];
  if (!isRecord(provider)) {
    throw new Error(`供应商不存在：${providerId}`);
  }

  const models = Array.isArray(provider.models) ? [...provider.models] : [];
  const nextModels = models.filter((modelEntry) => String(modelEntry?.id || "").trim() !== modelId);
  if (nextModels.length === models.length) {
    throw new Error(`模型不存在：${providerId}/${modelId}`);
  }

  const deletedRef = normalizeRef(providerId, modelId);
  const currentPrimary = String(nextConfig.agents.defaults.model.primary || "").trim();

  let providerRemoved = false;
  if (nextModels.length > 0) {
    provider.models = nextModels;
    remapModelOverrides(nextConfig, (ref) => (ref === deletedRef ? "" : ref));
  } else {
    delete providers[providerId];
    providerRemoved = true;
    const providerPrefix = `${providerId}/`;
    remapModelOverrides(nextConfig, (ref) => (ref.startsWith(providerPrefix) ? "" : ref));
  }

  if (currentPrimary === deletedRef || (providerRemoved && currentPrimary.startsWith(`${providerId}/`))) {
    nextConfig.agents.defaults.model.primary = "";
  }

  const normalized = normalizePrimaryAndOverrides(nextConfig);
  return {
    nextConfig,
    providerId,
    modelId,
    providerRemoved,
    primary: normalized.primary
  };
}

export { removeModelFromCatalog, removeProviderFromCatalog, updateModelInCatalog, updateProviderInCatalog };
