import assert from "node:assert/strict";
import test from "node:test";
import { generateGatewayToken, rotateGatewayTokenConfig } from "../../src/gateway-token.js";

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
