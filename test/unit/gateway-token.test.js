import assert from "node:assert/strict";
import test from "node:test";
import {
  generateGatewayToken,
  rotateGatewayTokenAndApprovePairings,
  rotateGatewayTokenConfig
} from "../../src/gateway-token.js";

test("generateGatewayToken creates a 64-char hex string", () => {
  const token = generateGatewayToken();
  assert.equal(token.length, 64);
  assert.match(token, /^[0-9a-f]{64}$/);
});

test("rotateGatewayTokenConfig always returns a new token and keeps gateway siblings", () => {
  const current = {
    gateway: {
      auth: {
        mode: "token",
        token: "old-token"
      },
      rpc: {
        endpoint: "http://127.0.0.1:8789"
      }
    }
  };
  const generated = ["old-token", "old-token", "new-token"];
  const result = rotateGatewayTokenConfig(current, () => generated.shift() || "");

  assert.equal(result.token, "new-token");
  assert.equal(result.source, "generated-rotate");
  assert.equal(result.changed, true);
  assert.equal(result.nextConfig.gateway.auth.mode, "token");
  assert.equal(result.nextConfig.gateway.auth.token, "new-token");
  assert.deepEqual(result.nextConfig.gateway.rpc, { endpoint: "http://127.0.0.1:8789" });
  assert.equal(current.gateway.auth.token, "old-token");
});

test("rotateGatewayTokenConfig creates gateway auth block when missing", () => {
  const result = rotateGatewayTokenConfig({}, () => "fresh-token");

  assert.equal(result.token, "fresh-token");
  assert.equal(result.changed, true);
  assert.equal(result.nextConfig.gateway.auth.mode, "token");
  assert.equal(result.nextConfig.gateway.auth.token, "fresh-token");
});

test("rotateGatewayTokenConfig throws when generator cannot produce usable token", () => {
  assert.throws(
    () => rotateGatewayTokenConfig({ gateway: { auth: { token: "same" } } }, () => "same"),
    /Gateway Token 生成失败/
  );
});

test("rotateGatewayTokenAndApprovePairings returns token result and auto-approve success", async () => {
  const saves = [];
  const syncResult = await rotateGatewayTokenAndApprovePairings({
    openclawConfig: {
      gateway: {
        auth: {
          mode: "token",
          token: "old-token"
        }
      }
    },
    panelConfig: { runtime: { mode: "direct" } },
    configPath: "/tmp/openclaw.json",
    saveConfig: async (configPath, nextConfig) => {
      saves.push({ configPath, nextConfig });
      return {
        path: configPath,
        backupPath: `${configPath}.bak`
      };
    },
    approvePendingPairings: async () => ({
      ok: true,
      message: "已批准 1 个待处理设备配对请求",
      pendingCount: 1,
      approvedCount: 1,
      failedCount: 0,
      pending: [],
      approvals: [],
      steps: []
    })
  });

  assert.equal(syncResult.tokenResult.changed, true);
  assert.equal(syncResult.tokenResult.token.length, 64);
  assert.notEqual(syncResult.tokenResult.token, "old-token");
  assert.equal(syncResult.saved.path, "/tmp/openclaw.json");
  assert.equal(syncResult.autoApprove.ok, true);
  assert.equal(syncResult.autoApprove.approvedCount, 1);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].configPath, "/tmp/openclaw.json");
  assert.equal(saves[0].nextConfig.gateway.auth.mode, "token");
});

test("rotateGatewayTokenAndApprovePairings degrades when auto-approve throws", async () => {
  const syncResult = await rotateGatewayTokenAndApprovePairings({
    openclawConfig: {},
    panelConfig: {},
    configPath: "/tmp/openclaw.json",
    saveConfig: async () => ({
      path: "/tmp/openclaw.json",
      backupPath: "/tmp/openclaw.json.bak"
    }),
    approvePendingPairings: async () => {
      throw new Error("openclaw devices list --json failed");
    }
  });

  assert.equal(syncResult.tokenResult.changed, true);
  assert.equal(syncResult.autoApprove.ok, false);
  assert.match(syncResult.autoApprove.message, /自动批准待处理配对失败/);
  assert.equal(syncResult.autoApprove.pendingCount, 0);
});
