import assert from "node:assert/strict";
import test from "node:test";
import { checkBotDirectUpdate, mutateBotDirectUpdate, parseOpenClawUpdateStatus } from "../../src/direct-update.js";

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
