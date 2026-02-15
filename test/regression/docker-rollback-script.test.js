import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function canUseBash() {
  try {
    execFileSync("bash", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const runIfBash = process.platform === "win32" ? test.skip : canUseBash() ? test : test.skip;

runIfBash("docker-rollback keeps .env unchanged when target image pull fails", () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "openclaw-rollback-"));
  const deployDir = path.join(tempRoot, "deploy");
  const binDir = path.join(tempRoot, "bin");
  mkdirSync(deployDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  copyFileSync(path.resolve("deploy/docker-rollback.sh"), path.join(deployDir, "docker-rollback.sh"));
  writeFileSync(path.join(tempRoot, ".env"), "OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:2026.2.14\n", "utf8");

  const callLogPath = path.join(tempRoot, "docker-calls.log").replace(/\\/g, "/");
  const dockerStubPath = path.join(binDir, "docker");
  writeFileSync(
    dockerStubPath,
    `#!/usr/bin/env bash
echo "$@" >> "${callLogPath}"
if [[ "$1" == "pull" ]]; then
  exit 1
fi
exit 0
`,
    { mode: 0o755 }
  );

  let failed = false;
  try {
    execFileSync("bash", ["deploy/docker-rollback.sh", "v2026.2.99"], {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
        RETRY_SLEEP_SECONDS: "0"
      },
      stdio: "pipe"
    });
  } catch {
    failed = true;
  }

  assert.equal(failed, true);
  const envFile = readFileSync(path.join(tempRoot, ".env"), "utf8");
  assert.match(envFile, /OPENCLAW_IMAGE=ghcr\.io\/openclaw\/openclaw:2026\.2\.14/);

  const calls = readFileSync(path.join(tempRoot, "docker-calls.log"), "utf8");
  assert.match(calls, /pull ghcr\.io\/openclaw\/openclaw:2026\.2\.99/);
  assert.doesNotMatch(calls, /compose up -d openclaw-gateway/);
});
