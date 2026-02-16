import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardSummary } from "../../src/dashboard-service.js";

function createSettingsFixture() {
  return {
    model: {
      primary: "aicodecat-gpt/gpt-5.2",
      providerId: "aicodecat-gpt",
      modelId: "gpt-5.2",
      modelName: "GPT-5.2",
      contextWindow: 400000,
      maxTokens: 128000,
      thinkingStrength: "high",
      catalog: {
        providers: [
          {
            id: "aicodecat-gpt",
            api: "openai-responses",
            baseUrl: "https://aicode.cat/v1",
            models: [
              {
                id: "gpt-5.2",
                name: "GPT-5.2",
                contextWindow: 400000,
                maxTokens: 128000,
                thinkingStrength: "high"
              },
              {
                id: "gpt-5.3-codex",
                name: "GPT-5.3 Codex",
                contextWindow: 400000,
                maxTokens: 128000,
                thinkingStrength: "medium"
              }
            ]
          }
        ]
      }
    },
    channels: {
      telegram: { enabled: true, dmPolicy: "pairing", groupPolicy: "allowlist" },
      feishu: { enabled: false, dmPolicy: "pairing", groupPolicy: "allowlist" },
      discord: { enabled: false, dmPolicy: "pairing", groupPolicy: "allowlist" },
      slack: { enabled: true, dmPolicy: "allowlist", groupPolicy: "allowlist" }
    }
  };
}

test("buildDashboardSummary aggregates model/channel/skills/runtime", async () => {
  const panelConfig = { runtime: { mode: "docker" } };
  const settings = createSettingsFixture();

  const summary = await buildDashboardSummary({
    panelConfig,
    openclawConfig: {},
    deps: {
      extractSettings: () => settings,
      runServiceAction: async () => ({ ok: true, active: true, message: "running" }),
      callGatewayRpc: async ({ method }) => {
        if (method === "channels.status") {
          return {
            channelOrder: ["telegram", "slack"],
            channelLabels: { telegram: "Telegram", slack: "Slack" },
            channels: {
              telegram: { configured: true, running: true, lastError: "" },
              slack: { configured: true, running: false, lastError: "disabled" }
            }
          };
        }
        if (method === "skills.status") {
          return {
            skills: [
              { skillKey: "skill-a", name: "Skill A", disabled: false, eligible: true, blockedByAllowlist: false },
              { skillKey: "skill-b", name: "Skill B", disabled: true, eligible: false, blockedByAllowlist: true }
            ]
          };
        }
        throw new Error(`unexpected method ${method}`);
      }
    }
  });

  assert.equal(summary.runtime.ok, true);
  assert.equal(summary.runtime.active, true);
  assert.equal(summary.runtime.mode, "docker");
  assert.equal(summary.model.counts.providers, 1);
  assert.equal(summary.model.counts.models, 2);
  assert.equal(summary.channels.configured.total, 4);
  assert.equal(summary.channels.configured.enabled, 2);
  assert.equal(summary.channels.runtime.ok, true);
  assert.equal(summary.channels.runtime.running, 1);
  assert.equal(summary.skills.ok, true);
  assert.equal(summary.skills.total, 2);
  assert.equal(summary.skills.enabled, 1);
  assert.equal(summary.skills.blocked, 1);
});

test("buildDashboardSummary degrades gracefully when runtime/gateway calls fail", async () => {
  const panelConfig = { runtime: { mode: "systemd" } };
  const settings = createSettingsFixture();

  const summary = await buildDashboardSummary({
    panelConfig,
    openclawConfig: {},
    deps: {
      extractSettings: () => settings,
      runServiceAction: async () => {
        throw new Error("status failed");
      },
      callGatewayRpc: async () => {
        throw new Error("gateway unavailable");
      }
    }
  });

  assert.equal(summary.runtime.ok, false);
  assert.equal(summary.runtime.mode, "systemd");
  assert.match(summary.runtime.message, /status failed/);
  assert.equal(summary.channels.runtime.ok, false);
  assert.match(summary.channels.runtime.message, /gateway unavailable/);
  assert.equal(summary.skills.ok, false);
  assert.match(summary.skills.message, /gateway unavailable/);
});
