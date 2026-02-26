import assert from "node:assert/strict";
import test from "node:test";
import { runServiceAction } from "../../src/systemd.js";

function createExecStub(handlers) {
  const calls = [];
  const exec = (command, args, options, cb) => {
    const key = [command, ...(args || [])].join(" ").trim();
    calls.push({ command, args });
    const handler = handlers[key] || handlers[command] || {};
    const error = handler.error || null;
    const stdout = handler.stdout || "";
    const stderr = handler.stderr || "";
    cb(error, stdout, stderr);
  };
  exec.calls = calls;
  return exec;
}

const basePanelConfig = {
  runtime: { mode: "systemd" },
  openclaw: { service_name: "openclaw-gateway" }
};

test("runServiceAction 优先使用 openclaw CLI", async () => {
  const execStub = createExecStub({
    "openclaw gateway restart": { stdout: "ok" }
  });
  const result = await runServiceAction("restart", basePanelConfig, {
    execFile: execStub,
    platform: "win32"
  });
  assert.equal(result.ok, true);
  assert.equal(execStub.calls.length, 1);
  assert.equal(execStub.calls[0].command, "openclaw");
});

test("Linux 环境优先使用 systemctl", async () => {
  const execStub = createExecStub({
    "systemctl restart openclaw-gateway": { stdout: "done" }
  });
  const result = await runServiceAction("restart", basePanelConfig, {
    execFile: execStub,
    platform: "linux"
  });
  assert.equal(result.ok, true);
  assert.equal(execStub.calls.length, 1);
  assert.equal(execStub.calls[0].command, "systemctl");
});

test("Linux 环境 systemctl 失败时回退 openclaw CLI", async () => {
  const systemdError = new Error("systemctl failed");
  systemdError.code = 1;
  const execStub = createExecStub({
    "systemctl restart openclaw-gateway": { error: systemdError, stderr: "failed to restart" },
    "openclaw gateway restart": { stdout: "ok" }
  });
  const result = await runServiceAction("restart", basePanelConfig, {
    execFile: execStub,
    platform: "linux"
  });
  assert.equal(result.ok, true);
  assert.equal(execStub.calls.length, 2);
  assert.equal(execStub.calls[0].command, "systemctl");
  assert.equal(execStub.calls[1].command, "openclaw");
});

test("Windows 环境 CLI 缺失时给出提示", async () => {
  const enoent = new Error("spawn openclaw ENOENT");
  enoent.code = "ENOENT";
  const enoentCmd = new Error("spawn openclaw.cmd ENOENT");
  enoentCmd.code = "ENOENT";
  const execStub = createExecStub({
    "openclaw gateway restart": { error: enoent },
    "openclaw.cmd gateway restart": { error: enoentCmd }
  });
  const result = await runServiceAction("restart", basePanelConfig, {
    execFile: execStub,
    platform: "win32"
  });
  assert.equal(result.ok, false);
  assert.match(result.output, /openclaw CLI/);
});

test("Windows 环境 openclaw 缺失时回退 openclaw.cmd", async () => {
  const enoent = new Error("spawn openclaw ENOENT");
  enoent.code = "ENOENT";
  const execStub = createExecStub({
    "openclaw gateway restart": { error: enoent },
    "openclaw.cmd gateway restart": { stdout: "ok" }
  });
  const result = await runServiceAction("restart", basePanelConfig, {
    execFile: execStub,
    platform: "win32"
  });
  assert.equal(result.ok, true);
  assert.equal(execStub.calls.length, 2);
  assert.equal(execStub.calls[0].command, "openclaw");
  assert.equal(execStub.calls[1].command, "openclaw.cmd");
});
