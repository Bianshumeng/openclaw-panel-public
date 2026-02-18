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
    json: async () => [
      {
        updated_at: "2026-02-15T00:00:00Z",
        metadata: {
          container: {
            tags: ["latest", "2026.2.15", "sha-abcdef01"]
          }
        }
      }
    ]
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
  assert.equal(calledUrl, "https://api.github.com/users/openclaw/packages/container/openclaw/versions?per_page=100");
  assert.equal(result.currentTag, "2026.2.14");
  assert.equal(result.latestTag, "2026.2.15");
  assert.equal(result.updateAvailable, true);
  assert.equal(result.warning, "");
});

test("checkForUpdates tolerates release API failure", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/users/")) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const result = await checkForUpdates({
    containerName: "openclaw-gateway",
    runCmd: makeRunCmdForInspect(),
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.currentTag, "2026.2.14");
  assert.equal(result.latestTag, "");
  assert.equal(result.updateAvailable, false);
  assert.match(result.warning, /404/);
});

test("checkForUpdates uses configured image repo for release query", async () => {
  let calledUrl = "";
  const fetchImpl = async (url) => {
    calledUrl = url;
    return {
      ok: true,
      json: async () => [
        {
          updated_at: "2026-02-16T00:00:00Z",
          metadata: {
            container: {
              tags: ["latest", "2026.2.16"]
            }
          }
        }
      ]
    };
  };

  const result = await checkForUpdates({
    containerName: "openclaw-gateway",
    imageRepo: "ghcr.io/custom-owner/custom-openclaw",
    runCmd: makeRunCmdForInspect(),
    fetchImpl
  });

  assert.equal(calledUrl, "https://api.github.com/users/custom-owner/packages/container/custom-openclaw/versions?per_page=100");
  assert.equal(result.releaseRepo, "custom-owner/custom-openclaw");
  assert.equal(result.latestTag, "2026.2.16");
  assert.equal(result.updateAvailable, true);
});

test("checkForUpdates returns warning when image repo cannot map to supported source", async () => {
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
  assert.match(result.warning, /无法从镜像仓库推导 GitHub 仓库或 GHCR 包/);
});

test("checkForUpdates keeps running when current tag is non-semver", async () => {
  const runCmd = async (command, args) => {
    const cmdline = `${command} ${args.join(" ")}`;
    if (cmdline === "docker inspect openclaw-panel") {
      return {
        ok: true,
        stdout: JSON.stringify([
          {
            ...snapshot,
            Name: "/openclaw-panel",
            Config: {
              ...snapshot.Config,
              Image: "openclaw-panel:local"
            }
          }
        ]),
        stderr: "",
        message: ""
      };
    }
    return { ok: false, stdout: "", stderr: `unexpected command: ${cmdline}`, message: "unexpected" };
  };

  const fetchImpl = async () => ({
    ok: true,
    json: async () => [
      {
        updated_at: "2026-02-17T10:10:59Z",
        metadata: {
          container: {
            tags: ["latest", "0.1.0", "sha-4a9d5674c09d"]
          }
        }
      }
    ]
  });

  const result = await checkForUpdates({
    containerName: "openclaw-panel",
    imageRepo: "ghcr.io/bianshumeng/openclaw-panel",
    runCmd,
    fetchImpl
  });

  assert.equal(result.currentTag, "local");
  assert.equal(result.latestTag, "0.1.0");
  assert.equal(result.updateAvailable, true);
  assert.equal(result.warning, "");
});

test("checkForUpdates falls back to GHCR anonymous token for public packages", async () => {
  const runCmd = async (command, args) => {
    const cmdline = `${command} ${args.join(" ")}`;
    if (cmdline === "docker inspect openclaw-panel") {
      return {
        ok: true,
        stdout: JSON.stringify([
          {
            ...snapshot,
            Name: "/openclaw-panel",
            Config: {
              ...snapshot.Config,
              Image: "openclaw-panel:local"
            }
          }
        ]),
        stderr: "",
        message: ""
      };
    }
    return { ok: false, stdout: "", stderr: `unexpected command: ${cmdline}`, message: "unexpected" };
  };

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const text = String(url);
    calls.push(text);

    if (text === "https://api.github.com/users/bianshumeng/packages/container/openclaw-panel/versions?per_page=100") {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    if (text === "https://ghcr.io/token?scope=repository%3Abianshumeng%2Fopenclaw-panel%3Apull&service=ghcr.io") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "public-pull-token" })
      };
    }
    if (text === "https://ghcr.io/v2/bianshumeng/openclaw-panel/tags/list") {
      assert.equal(options?.headers?.authorization, "Bearer public-pull-token");
      return {
        ok: true,
        status: 200,
        json: async () => ({ tags: ["latest", "sha-abcd1234", "0.1.0"] })
      };
    }

    return { ok: false, status: 404, json: async () => ({}) };
  };

  const result = await checkForUpdates({
    containerName: "openclaw-panel",
    imageRepo: "ghcr.io/bianshumeng/openclaw-panel",
    runCmd,
    fetchImpl
  });

  assert.equal(result.latestTag, "0.1.0");
  assert.equal(result.updateAvailable, true);
  assert.equal(result.warning, "");
  assert.ok(calls.some((item) => item.startsWith("https://ghcr.io/token?scope=repository%3Abianshumeng%2Fopenclaw-panel%3Apull")));
});

test("checkForUpdates still falls back to GHCR anonymous token when configured token is invalid", async () => {
  const runCmd = async (command, args) => {
    const cmdline = `${command} ${args.join(" ")}`;
    if (cmdline === "docker inspect openclaw-panel") {
      return {
        ok: true,
        stdout: JSON.stringify([
          {
            ...snapshot,
            Name: "/openclaw-panel",
            Config: {
              ...snapshot.Config,
              Image: "ghcr.io/bianshumeng/openclaw-panel:0.1.0"
            }
          }
        ]),
        stderr: "",
        message: ""
      };
    }
    return { ok: false, stdout: "", stderr: `unexpected command: ${cmdline}`, message: "unexpected" };
  };

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const text = String(url);
    calls.push(text);

    if (text === "https://api.github.com/users/bianshumeng/packages/container/openclaw-panel/versions?per_page=100") {
      assert.equal(options?.headers?.authorization, "Bearer expired-token");
      return { ok: false, status: 403, json: async () => ({}) };
    }
    if (text === "https://ghcr.io/token?scope=repository%3Abianshumeng%2Fopenclaw-panel%3Apull&service=ghcr.io") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "public-fallback-token" })
      };
    }
    if (text === "https://ghcr.io/v2/bianshumeng/openclaw-panel/tags/list") {
      assert.equal(options?.headers?.authorization, "Bearer public-fallback-token");
      return {
        ok: true,
        status: 200,
        json: async () => ({ tags: ["latest", "sha-11aa22bb", "0.1.1"] })
      };
    }

    return { ok: false, status: 404, json: async () => ({}) };
  };

  const result = await checkForUpdates({
    containerName: "openclaw-panel",
    imageRepo: "ghcr.io/bianshumeng/openclaw-panel",
    githubToken: "expired-token",
    runCmd,
    fetchImpl
  });

  assert.equal(result.latestTag, "0.1.1");
  assert.equal(result.updateAvailable, true);
  assert.equal(result.warning, "");
  assert.ok(calls.some((item) => item.includes("https://api.github.com/users/bianshumeng/packages/container/openclaw-panel/versions")));
  assert.ok(calls.some((item) => item.startsWith("https://ghcr.io/token?scope=repository%3Abianshumeng%2Fopenclaw-panel%3Apull")));
});
