import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkBotDirectUpdate,
  mutateBotDirectUpdate,
  parseOpenClawUpdateStatus,
  stagePanelDirectUpdate
} from "../../src/direct-update.js";

test("parseOpenClawUpdateStatus extracts install method and latest version", () => {
  const raw = `
OpenClaw update status
│ Install  │ pnpm                                                                 │
│ Channel  │ stable (default)                                                     │
│ Update   │ available · pnpm · npm update 2026.2.19-2                            │
`;
  const parsed = parseOpenClawUpdateStatus(raw);
  assert.equal(parsed.installMethod, "global");
  assert.equal(parsed.strategy, "package-manager");
  assert.equal(parsed.latestTag, "2026.2.19-2");
  assert.equal(parsed.updateAvailable, true);
});

test("checkBotDirectUpdate returns warning when status command fails", async () => {
  const runCmd = async (command, args) => {
    if (command === "openclaw" && args[0] === "--version") {
      return { ok: true, stdout: "2026.1.30", stderr: "", message: "" };
    }
    return { ok: false, stdout: "", stderr: "status failed", message: "" };
  };
  const result = await checkBotDirectUpdate({ runCmd });
  assert.equal(result.currentTag, "2026.1.30");
  assert.equal(result.updateAvailable, false);
  assert.match(result.warning, /status failed/);
});

test("mutateBotDirectUpdate requires rollback tag", async () => {
  const runCmd = async () => ({ ok: true, stdout: "", stderr: "", message: "" });
  const result = await mutateBotDirectUpdate({ action: "rollback", tag: "", runCmd });
  assert.equal(result.ok, false);
  assert.match(result.message, /回滚必须提供目标版本号/);
});

test("stagePanelDirectUpdate does not force octet-stream accept header for tarball", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "panel-update-test-"));
  const appDir = path.join(tempRoot, "app");
  const stateDir = path.join(tempRoot, "state");
  await fs.mkdir(appDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(appDir, "package.json"), JSON.stringify({ version: "0.1.3" }));

  let tarballHeaders = null;
  const fetchImpl = async (url, { headers } = {}) => {
    const target = String(url);
    if (target.includes("/releases/latest")) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            tag_name: "v0.1.4",
            tarball_url: "https://api.github.com/repos/foo/bar/tarball/v0.1.4",
            published_at: "2026-02-26T00:00:00Z"
          })
      };
    }
    if (target.includes("/tarball/")) {
      tarballHeaders = headers || {};
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer
      };
    }
    return { ok: false, status: 404, text: async () => "not found" };
  };

  try {
    const result = await stagePanelDirectUpdate({ releaseRepo: "foo/bar", fetchImpl, appDir, stateDir });
    assert.equal(result.ok, true);
    assert.ok(tarballHeaders);
    assert.notEqual(tarballHeaders.accept, "application/octet-stream");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
