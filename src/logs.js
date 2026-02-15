import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { expandHome, toPositiveInt } from "./utils.js";

function splitLines(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function filterLines(lines, keyword) {
  if (!keyword) {
    return lines;
  }
  const lower = keyword.toLowerCase();
  return lines.filter((line) => line.toLowerCase().includes(lower));
}

async function readLastLinesFromFile(filePath, maxLines) {
  try {
    const raw = await fs.readFile(expandHome(filePath), "utf8");
    const lines = splitLines(raw);
    return lines.slice(-maxLines);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", () => resolve({ stdout, stderr }));
  });
}

export async function getTailLogs({ panelConfig, lines = 200, filter = "" }) {
  const maxLines = Math.min(5000, toPositiveInt(lines, 200));
  const source = panelConfig.log.source;
  const containerName =
    panelConfig?.openclaw?.container_name || panelConfig?.openclaw?.service_name || "openclaw-gateway";

  if (source === "docker" || panelConfig?.runtime?.mode === "docker") {
    const { stdout, stderr } = await runCapture("docker", ["logs", "--tail", String(maxLines), containerName]);
    const merged = `${stdout}\n${stderr}`;
    return filterLines(splitLines(merged), filter);
  }

  if (source === "journal" && process.platform === "linux") {
    const { stdout, stderr } = await runCapture("journalctl", [
      "-u",
      panelConfig.openclaw.service_name,
      "-n",
      String(maxLines),
      "--no-pager",
      "-o",
      "short-iso"
    ]);

    const merged = `${stdout}\n${stderr}`;
    return filterLines(splitLines(merged), filter);
  }

  return filterLines(await readLastLinesFromFile(panelConfig.log.file_path, maxLines), filter);
}

export async function getErrorSummary({ panelConfig, count = 20 }) {
  const lines = await getTailLogs({ panelConfig, lines: 1000, filter: "" });
  const errorPattern = /(error|fail|exception|panic|fatal|traceback)/i;
  const matched = lines.filter((line) => errorPattern.test(line));
  return matched.slice(-Math.min(200, toPositiveInt(count, 20)));
}

export function createLogStream({ panelConfig, onLine, onError }) {
  const source = panelConfig.log.source;
  const containerName =
    panelConfig?.openclaw?.container_name || panelConfig?.openclaw?.service_name || "openclaw-gateway";
  let child;

  if (source === "docker" || panelConfig?.runtime?.mode === "docker") {
    child = spawn("docker", ["logs", "-f", "--tail", "20", containerName]);
  } else if (source === "journal" && process.platform === "linux") {
    child = spawn("journalctl", [
      "-u",
      panelConfig.openclaw.service_name,
      "-f",
      "-n",
      "20",
      "--no-pager",
      "-o",
      "short-iso"
    ]);
  } else {
    child = spawn("tail", ["-n", "20", "-F", expandHome(panelConfig.log.file_path)]);
  }

  child.stdout.on("data", (chunk) => {
    const lines = splitLines(chunk.toString());
    for (const line of lines) {
      onLine(line);
    }
  });

  child.stderr.on("data", (chunk) => {
    const lines = splitLines(chunk.toString());
    for (const line of lines) {
      onError(line);
    }
  });

  child.on("error", (error) => {
    onError(error.message);
  });

  return () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  };
}
