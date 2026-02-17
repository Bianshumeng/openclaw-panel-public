import test from "node:test";
import assert from "node:assert/strict";
import {
  removeModelFromCatalog,
  removeProviderFromCatalog,
  updateModelInCatalog,
  updateProviderInCatalog
} from "../../src/openclaw-config.js";

function makeCatalogConfig() {
  return {
    models: {
      providers: {
        "aicodecat-gpt": {
          api: "openai-responses",
          baseUrl: "https://aicode.cat/v1",
          apiKey: "sk-old",
          models: [
            {
              id: "gpt-5.2",
              name: "GPT-5.2",
              contextWindow: 400000,
              maxTokens: 128000
            },
            {
              id: "gpt-5.3-codex",
              name: "GPT-5.3 Codex",
              contextWindow: 400000,
              maxTokens: 128000
            }
          ]
        },
        "aicodecat-claude": {
          api: "anthropic-messages",
          baseUrl: "https://aicode.cat",
          models: [
            {
              id: "claude-sonnet-4-5-20250929",
              name: "Claude Sonnet 4.5",
              contextWindow: 200000,
              maxTokens: 64000
            }
          ]
        }
      }
    },
    agents: {
      defaults: {
        model: {
          primary: "aicodecat-gpt/gpt-5.2"
        },
        models: {
          "aicodecat-gpt/gpt-5.2": {
            thinkingStrength: "high"
          },
          "aicodecat-claude/claude-sonnet-4-5-20250929": {
            thinkingStrength: "medium"
          }
        }
      }
    },
    channels: {}
  };
}

test("updateProviderInCatalog renames provider and remaps model references", () => {
  const result = updateProviderInCatalog(makeCatalogConfig(), {
    providerId: "aicodecat-gpt",
    nextProviderId: "my-openai",
    api: "openai-completions",
    baseUrl: "https://api.example.com/v1"
  });

  assert.equal(result.providerId, "my-openai");
  assert.equal(result.primary, "my-openai/gpt-5.2");
  assert.equal(result.nextConfig.models.providers["aicodecat-gpt"], undefined);
  assert.equal(result.nextConfig.models.providers["my-openai"].api, "openai-completions");
  assert.equal(result.nextConfig.models.providers["my-openai"].baseUrl, "https://api.example.com/v1");
  assert.ok(result.nextConfig.agents.defaults.models["my-openai/gpt-5.2"]);
  assert.equal(result.nextConfig.agents.defaults.models["aicodecat-gpt/gpt-5.2"], undefined);
});

test("updateModelInCatalog supports renaming model and updating limits", () => {
  const result = updateModelInCatalog(makeCatalogConfig(), {
    providerId: "aicodecat-gpt",
    modelId: "gpt-5.2",
    nextModelId: "gpt-5.2-mini",
    name: "GPT-5.2 Mini",
    contextWindow: 250000
  });

  assert.equal(result.primary, "aicodecat-gpt/gpt-5.2-mini");
  const models = result.nextConfig.models.providers["aicodecat-gpt"].models;
  assert.ok(models.some((item) => item.id === "gpt-5.2-mini"));
  assert.equal(models.some((item) => item.id === "gpt-5.2"), false);
  const edited = models.find((item) => item.id === "gpt-5.2-mini");
  assert.equal(edited.name, "GPT-5.2 Mini");
  assert.equal(edited.contextWindow, 250000);
  assert.equal(edited.maxTokens, 128000);
  assert.ok(result.nextConfig.agents.defaults.models["aicodecat-gpt/gpt-5.2-mini"]);
  assert.equal(result.nextConfig.agents.defaults.models["aicodecat-gpt/gpt-5.2"], undefined);
});

test("removeModelFromCatalog removes target model and keeps valid fallback primary", () => {
  const result = removeModelFromCatalog(makeCatalogConfig(), {
    providerId: "aicodecat-gpt",
    modelId: "gpt-5.2"
  });

  const models = result.nextConfig.models.providers["aicodecat-gpt"].models;
  assert.equal(models.some((item) => item.id === "gpt-5.2"), false);
  assert.equal(models.some((item) => item.id === "gpt-5.3-codex"), true);
  assert.equal(result.primary, "aicodecat-gpt/gpt-5.3-codex");
  assert.equal(result.nextConfig.agents.defaults.models["aicodecat-gpt/gpt-5.2"], undefined);
});

test("removeProviderFromCatalog removes provider and falls back to another available model", () => {
  const result = removeProviderFromCatalog(makeCatalogConfig(), {
    providerId: "aicodecat-gpt"
  });

  assert.equal(result.nextConfig.models.providers["aicodecat-gpt"], undefined);
  assert.equal(result.primary, "aicodecat-claude/claude-sonnet-4-5-20250929");
  assert.ok(result.nextConfig.agents.defaults.models["aicodecat-claude/claude-sonnet-4-5-20250929"]);
  assert.equal(result.nextConfig.agents.defaults.models["aicodecat-gpt/gpt-5.2"], undefined);
});

test("removeProviderFromCatalog clears primary when no models remain", () => {
  const config = makeCatalogConfig();
  delete config.models.providers["aicodecat-claude"];

  const result = removeProviderFromCatalog(config, {
    providerId: "aicodecat-gpt"
  });

  assert.equal(result.primary, "");
  assert.deepEqual(result.nextConfig.models.providers, {});
  assert.deepEqual(result.nextConfig.agents.defaults.models, {});
});
