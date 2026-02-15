import test from "node:test";
import assert from "node:assert/strict";
import {
  apiModeFamily,
  resolveAicodecatBaseUrl,
  resolveProviderId,
  convertConfig
} from "../../public/config-generator.js";

test("api mode family maps gpt/claude/gemini", () => {
  assert.equal(apiModeFamily("openai-responses"), "gpt");
  assert.equal(apiModeFamily("openai-completions"), "gpt");
  assert.equal(apiModeFamily("anthropic-messages"), "claude");
  assert.equal(apiModeFamily("google-generative-ai"), "gemini");
});

test("aicodecat base url switches by api mode", () => {
  assert.equal(resolveAicodecatBaseUrl("openai-responses"), "https://aicode.cat/v1");
  assert.equal(resolveAicodecatBaseUrl("anthropic-messages"), "https://aicode.cat");
  assert.equal(resolveAicodecatBaseUrl("google-generative-ai"), "https://aicode.cat/v1beta");
});

test("provider id derives from api mode for aicodecat", () => {
  assert.equal(resolveProviderId("aicodecat", "openai-responses"), "aicodecat-gpt");
  assert.equal(resolveProviderId("aicodecat", "anthropic-messages"), "aicodecat-claude");
  assert.equal(resolveProviderId("aicodecat", "google-generative-ai"), "aicodecat-gemini");
  assert.equal(resolveProviderId("custom-provider", "openai-responses"), "custom-provider");
});

test("convertConfig defaults to clean output and removes auth", () => {
  const result = convertConfig({
    config: JSON.stringify({
      messages: { a: 1 },
      auth: { token: "x" },
      agents: {
        defaults: {
          workspace: "/tmp/workspace",
          thinkingDefault: "high",
          model: {
            mode: "keep"
          }
        },
        extraAgentConfig: {
          enabled: true
        }
      }
    }),
    baseurl: "https://aicode.cat/v1",
    apikey: "sk-test",
    apimode: "openai-responses",
    provider: "aicodecat",
    model_id: "gpt-5.2"
  });

  assert.equal(result.auth, undefined);
  assert.equal(result.models.mode, "merge");
  assert.equal(result.models.providers["aicodecat-gpt"].baseUrl, "https://aicode.cat/v1");
  assert.equal(result.agents.defaults.model.primary, "aicodecat-gpt/gpt-5.2");
  assert.equal(result.messages, undefined);
  assert.equal(result.agents.defaults.workspace, undefined);
  assert.equal(result.agents.defaults.thinkingDefault, undefined);
  assert.equal(result.agents.defaults.model.mode, undefined);
  assert.equal(result.agents.extraAgentConfig, undefined);
});

test("convertConfig inherits existing config when inherit_existing is true", () => {
  const result = convertConfig({
    config: JSON.stringify({
      messages: { a: 1 },
      auth: { token: "x" },
      agents: {
        defaults: {
          workspace: "/tmp/workspace",
          thinkingDefault: "high",
          model: {
            mode: "keep"
          }
        },
        extraAgentConfig: {
          enabled: true
        }
      }
    }),
    baseurl: "https://aicode.cat/v1",
    apikey: "sk-test",
    apimode: "openai-responses",
    provider: "aicodecat",
    model_id: "gpt-5.2",
    inherit_existing: true
  });

  assert.equal(result.auth, undefined);
  assert.equal(result.models.mode, "merge");
  assert.equal(result.models.providers["aicodecat-gpt"].baseUrl, "https://aicode.cat/v1");
  assert.equal(result.agents.defaults.model.primary, "aicodecat-gpt/gpt-5.2");
  assert.equal(result.agents.defaults.workspace, "/tmp/workspace");
  assert.equal(result.agents.defaults.thinkingDefault, "high");
  assert.equal(result.agents.defaults.model.mode, "keep");
  assert.equal(result.agents.extraAgentConfig.enabled, true);
  assert.deepEqual(result.messages, { a: 1 });
});

test("convertConfig throws on invalid json", () => {
  assert.throws(
    () =>
      convertConfig({
        config: "{ invalid }",
        baseurl: "https://aicode.cat/v1",
        apikey: "sk-test",
        apimode: "openai-responses",
        provider: "aicodecat",
        model_id: "gpt-5.2"
      }),
    /配置 JSON 格式错误/
  );
});
