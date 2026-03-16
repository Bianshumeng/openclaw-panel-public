import test from "node:test";
import assert from "node:assert/strict";
import { buildControlUiSelfHealConfig, normalizeControlUiOrigins } from "../../src/gateway-control-ui-recovery.js";

test("normalizeControlUiOrigins converts websocket url to loopback http origins", () => {
  const result = normalizeControlUiOrigins("ws://127.0.0.1:19002/#token=abc");

  assert.equal(result.origin, "http://127.0.0.1:19002");
  assert.deepEqual(result.origins, ["http://127.0.0.1:19002", "http://localhost:19002"]);
});

test("buildControlUiSelfHealConfig fixes gateway to local loopback none auth", () => {
  const result = buildControlUiSelfHealConfig(
    {
      gateway: {
        mode: "remote",
        bind: "lan",
        remote: {
          url: "ws://10.0.0.1:28789"
        },
        auth: {
          mode: "token",
          token: "secret"
        },
        controlUi: {
          allowedOrigins: ["http://127.0.0.1:18789"],
          allowInsecureAuth: false
        }
      }
    },
    {
      controlUiUrl: "ws://127.0.0.1:19002"
    }
  );

  assert.equal(result.nextConfig.gateway.mode, "local");
  assert.equal(result.nextConfig.gateway.bind, "loopback");
  assert.deepEqual(result.nextConfig.gateway.remote, {});
  assert.equal(result.nextConfig.gateway.auth.mode, "none");
  assert.equal(result.nextConfig.gateway.auth.token, "secret");
  assert.equal(result.nextConfig.gateway.controlUi.allowInsecureAuth, true);
  assert.deepEqual(result.nextConfig.gateway.controlUi.allowedOrigins, [
    "http://127.0.0.1:18789",
    "http://127.0.0.1:19002",
    "http://localhost:19002"
  ]);
  assert.ok(result.changedKeys.includes("gateway.mode"));
  assert.ok(result.changedKeys.includes("gateway.bind"));
  assert.ok(result.changedKeys.includes("gateway.auth.mode"));
  assert.ok(result.changedKeys.includes("gateway.controlUi.allowedOrigins"));
});

test("buildControlUiSelfHealConfig falls back to default tunnel url", () => {
  const result = buildControlUiSelfHealConfig({}, {});

  assert.deepEqual(result.normalizedOrigins, ["http://127.0.0.1:19002", "http://localhost:19002"]);
  assert.equal(result.requestedInput, "ws://127.0.0.1:19002");
});

