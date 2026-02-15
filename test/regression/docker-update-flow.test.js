import test from "node:test";
import assert from "node:assert/strict";
import { rollbackToTag, upgradeToTag } from "../../src/docker-update.js";

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

function makeRunCmdQueue(steps) {
  const queue = [...steps];
  const calls = [];
  const runCmd = async (command, args) => {
    const cmdline = `${command} ${args.join(" ")}`;
    calls.push(cmdline);
    const step = queue.shift();
    assert.ok(step, `unexpected command: ${cmdline}`);
    assert.match(cmdline, step.match);
    return step.result;
  };
  runCmd.calls = calls;
  runCmd.left = () => queue.length;
  return runCmd;
}

test("upgradeToTag succeeds when new container starts", async () => {
  const runCmd = makeRunCmdQueue([
    { match: /^docker inspect openclaw-gateway$/, result: { ok: true, stdout: JSON.stringify([snapshot]), stderr: "", message: "" } },
    { match: /^docker pull ghcr\.io\/openclaw\/openclaw:2026\.2\.15$/, result: { ok: true, stdout: "pulled", stderr: "", message: "" } },
    { match: /^docker rm -f openclaw-gateway$/, result: { ok: true, stdout: "", stderr: "", message: "" } },
    { match: /^docker run -d --name openclaw-gateway .*ghcr\.io\/openclaw\/openclaw:2026\.2\.15/, result: { ok: true, stdout: "new-id", stderr: "", message: "" } },
    { match: /^docker inspect --format \{\{\.State\.Running\}\} openclaw-gateway$/, result: { ok: true, stdout: "true", stderr: "", message: "" } }
  ]);

  const result = await upgradeToTag({
    containerName: "openclaw-gateway",
    targetTag: "v2026.2.15",
    runCmd
  });

  assert.equal(result.ok, true);
  assert.equal(result.rolledBack, false);
  assert.equal(runCmd.left(), 0);
});

test("upgradeToTag auto rollbacks when start fails", async () => {
  const runCmd = makeRunCmdQueue([
    { match: /^docker inspect openclaw-gateway$/, result: { ok: true, stdout: JSON.stringify([snapshot]), stderr: "", message: "" } },
    { match: /^docker pull ghcr\.io\/openclaw\/openclaw:2026\.2\.99$/, result: { ok: true, stdout: "pulled", stderr: "", message: "" } },
    { match: /^docker rm -f openclaw-gateway$/, result: { ok: true, stdout: "", stderr: "", message: "" } },
    { match: /^docker run -d --name openclaw-gateway .*ghcr\.io\/openclaw\/openclaw:2026\.2\.99/, result: { ok: false, stdout: "", stderr: "run failed", message: "run failed" } },
    { match: /^docker pull ghcr\.io\/openclaw\/openclaw:2026\.2\.14$/, result: { ok: true, stdout: "pulled", stderr: "", message: "" } },
    { match: /^docker rm -f openclaw-gateway$/, result: { ok: true, stdout: "", stderr: "", message: "" } },
    { match: /^docker run -d --name openclaw-gateway .*ghcr\.io\/openclaw\/openclaw:2026\.2\.14/, result: { ok: true, stdout: "old-id", stderr: "", message: "" } },
    { match: /^docker inspect --format \{\{\.State\.Running\}\} openclaw-gateway$/, result: { ok: true, stdout: "true", stderr: "", message: "" } }
  ]);

  const result = await upgradeToTag({
    containerName: "openclaw-gateway",
    targetTag: "2026.2.99",
    runCmd
  });

  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.equal(runCmd.left(), 0);
});

test("rollbackToTag fails fast when image pull fails", async () => {
  const runCmd = makeRunCmdQueue([
    { match: /^docker inspect openclaw-gateway$/, result: { ok: true, stdout: JSON.stringify([snapshot]), stderr: "", message: "" } },
    { match: /^docker pull ghcr\.io\/openclaw\/openclaw:2026\.2\.01$/, result: { ok: false, stdout: "", stderr: "not found", message: "not found" } },
    { match: /^docker pull ghcr\.io\/openclaw\/openclaw:2026\.2\.01$/, result: { ok: false, stdout: "", stderr: "not found", message: "not found" } },
    { match: /^docker pull ghcr\.io\/openclaw\/openclaw:2026\.2\.01$/, result: { ok: false, stdout: "", stderr: "not found", message: "not found" } }
  ]);

  const result = await rollbackToTag({
    containerName: "openclaw-gateway",
    targetTag: "2026.2.01",
    runCmd
  });

  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, false);
  assert.equal(runCmd.left(), 0);
});
