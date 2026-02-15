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
  let calledUrl = "";
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ tag_name: "v2026.2.15", published_at: "2026-02-15T00:00:00Z" })
  });
  const wrappedFetch = async (url, options) => {
    calledUrl = url;
    return fetchImpl(url, options);
  };
  const result = await checkForUpdates({
    containerName: "openclaw-gateway",
    runCmd: makeRunCmdForInspect(),
    fetchImpl: wrappedFetch
  });
  assert.equal(result.ok, true);
  assert.equal(calledUrl, "https://api.github.com/repos/openclaw/openclaw/releases/latest");
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

test("checkForUpdates uses configured image repo for release query", async () => {
  let calledUrl = "";
  const fetchImpl = async (url) => {
    calledUrl = url;
    return {
      ok: true,
      json: async () => ({ tag_name: "v2026.2.16", published_at: "2026-02-16T00:00:00Z" })
    };
  };

  const result = await checkForUpdates({
    containerName: "openclaw-gateway",
    imageRepo: "ghcr.io/custom-owner/custom-openclaw",
    runCmd: makeRunCmdForInspect(),
    fetchImpl
  });

  assert.equal(calledUrl, "https://api.github.com/repos/custom-owner/custom-openclaw/releases/latest");
  assert.equal(result.releaseRepo, "custom-owner/custom-openclaw");
  assert.equal(result.latestTag, "2026.2.16");
  assert.equal(result.updateAvailable, true);
});

test("checkForUpdates returns warning when image repo cannot map to github repo", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, json: async () => ({}) };
  };

  const result = await checkForUpdates({
    containerName: "openclaw-gateway",
    imageRepo: "registry.internal.company/openclaw/prod",
    runCmd: makeRunCmdForInspect(),
    fetchImpl
  });

  assert.equal(called, false);
  assert.equal(result.latestTag, "");
  assert.equal(result.updateAvailable, false);
  assert.match(result.warning, /无法从镜像仓库推导 GitHub 仓库/);
});
