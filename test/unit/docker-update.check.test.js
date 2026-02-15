import test from "node:test";
import assert from "node:assert/strict";
import { checkForUpdates } from "../../src/docker-update.js";

const snapshot = {
  Name: "/openclaw-gateway",
  Config: {
    Image: "ghcr.io/openclaw/openclaw:2026.2.14"
  },
  HostConfig: {},
  NetworkSettings: { Networks: {} }
};

function makeRunCmdForInspect() {
  return async (command, args) => {
    const cmdline = `${command} ${args.join(" ")}`;
    if (cmdline === "docker inspect openclaw-gateway") {
      return { ok: true, stdout: JSON.stringify([snapshot]), stderr: "", message: "" };
    }
    return { ok: false, stdout: "", stderr: `unexpected command: ${cmdline}`, message: "unexpected" };
  };
}

test("checkForUpdates reports update available", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ tag_name: "v2026.2.15", published_at: "2026-02-15T00:00:00Z" })
  });
  const result = await checkForUpdates({
    containerName: "openclaw-gateway",
    runCmd: makeRunCmdForInspect(),
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.currentTag, "2026.2.14");
  assert.equal(result.latestTag, "2026.2.15");
  assert.equal(result.updateAvailable, true);
  assert.equal(result.warning, "");
});

test("checkForUpdates tolerates release API failure", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const result = await checkForUpdates({
    containerName: "openclaw-gateway",
    runCmd: makeRunCmdForInspect(),
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.currentTag, "2026.2.14");
  assert.equal(result.latestTag, "");
  assert.equal(result.updateAvailable, false);
  assert.match(result.warning, /GitHub API 请求失败/);
});
