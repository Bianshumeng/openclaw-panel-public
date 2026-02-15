import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function expandHome(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    return inputPath;
  }
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export async function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

export async function readJsonFile(filePath, fallback = {}) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonFileAtomic(filePath, data, mode = 0o600) {
  await ensureParentDir(filePath);
  const tempPath = `${filePath}.tmp`;
  const raw = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tempPath, raw, { encoding: "utf8", mode });
  await fs.rename(tempPath, filePath);
  try {
    await fs.chmod(filePath, mode);
  } catch {
    // ignore on systems that do not support chmod semantics
  }
}

export function maskSecret(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 6) {
    return "*".repeat(trimmed.length);
  }
  const tail = trimmed.slice(-4);
  return `${"*".repeat(Math.max(0, trimmed.length - 4))}${tail}`;
}

export function isLikelyMasked(value) {
  return typeof value === "string" && /^\*{4,}/.test(value);
}

export function pickTruthy(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

export function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function nowIso() {
  return new Date().toISOString();
}

