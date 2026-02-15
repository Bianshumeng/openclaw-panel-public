import test from "node:test";
import assert from "node:assert/strict";
import { buildDockerRunArgs, compareVersionTags, imageTagFromImage, makeImageRef, normalizeTag } from "../../src/docker-update.js";

const snapshot = {
  Name: "/openclaw-gateway",
  Config: {
    Image: "ghcr.io/openclaw/openclaw:2026.2.14",
    Env: ["HOME=/home/node", "OPENCLAW_GATEWAY_TOKEN=abc"],
    WorkingDir: "/home/node",
    User: "node",
    Cmd: ["node", "dist/index.js", "gateway", "--bind", "lan", "--port", "18789"]
  },
  HostConfig: {
    RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
    Binds: ["/data/openclaw:/home/node/.openclaw"],
    PortBindings: {
      "18789/tcp": [{ HostIp: "0.0.0.0", HostPort: "18789" }]
    },
    NetworkMode: "openclawpanel_default"
  },
  NetworkSettings: {
    Networks: {
      openclawpanel_default: {}
    }
  }
};

test("normalizeTag trims v prefix", () => {
  assert.equal(normalizeTag("v2026.2.14"), "2026.2.14");
  assert.equal(normalizeTag("2026.2.14"), "2026.2.14");
});

test("compareVersionTags compares numeric parts", () => {
  assert.equal(compareVersionTags("2026.2.15", "2026.2.14"), 1);
  assert.equal(compareVersionTags("2026.2.14", "2026.2.14"), 0);
  assert.equal(compareVersionTags("2026.1.30", "2026.2.14"), -1);
});

test("imageTagFromImage extracts last tag part", () => {
  assert.equal(imageTagFromImage("ghcr.io/openclaw/openclaw:2026.2.14"), "2026.2.14");
  assert.equal(imageTagFromImage("ghcr.io/openclaw/openclaw"), "");
});

test("makeImageRef builds GHCR image ref", () => {
  assert.equal(makeImageRef("v2026.2.14"), "ghcr.io/openclaw/openclaw:2026.2.14");
});

test("buildDockerRunArgs preserves key runtime settings", () => {
  const plan = buildDockerRunArgs(snapshot, "ghcr.io/openclaw/openclaw:2026.2.15");
  assert.equal(plan.containerName, "openclaw-gateway");
  assert.equal(plan.extraNetworks.length, 0);
  assert.ok(plan.args.includes("--restart"));
  assert.ok(plan.args.includes("unless-stopped"));
  assert.ok(plan.args.includes("-v"));
  assert.ok(plan.args.includes("/data/openclaw:/home/node/.openclaw"));
  assert.ok(plan.args.includes("-p"));
  assert.ok(plan.args.includes("18789:18789/tcp"));
  assert.ok(plan.args.includes("--network"));
  assert.ok(plan.args.includes("openclawpanel_default"));
  assert.ok(plan.args.includes("ghcr.io/openclaw/openclaw:2026.2.15"));
});
