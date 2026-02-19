import fs from "node:fs/promises";
import { expandHome, nowIso, readJsonFile, writeJsonFileAtomic } from "../utils.js";

function toNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function resolveExpectedOwner() {
  const rawUid = String(process.env.OPENCLAW_CONFIG_OWNER_UID ?? "").trim();
  const rawGid = String(process.env.OPENCLAW_CONFIG_OWNER_GID ?? "").trim();
  const hasUid = rawUid.length > 0;
  const hasGid = rawGid.length > 0;
  if (!hasUid && !hasGid) {
    return null;
  }
  const uid = toNonNegativeInt(rawUid, NaN);
  const gid = toNonNegativeInt(rawGid, NaN);
  if (!Number.isFinite(uid) || !Number.isFinite(gid)) {
    throw new Error("OPENCLAW_CONFIG_OWNER_UID / OPENCLAW_CONFIG_OWNER_GID 必须同时为非负整数");
  }
  return { uid, gid };
}

function isRootRuntime() {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

async function ensureOpenClawConfigPermissions(configPath) {
  const realPath = expandHome(configPath);
  let stats;
  try {
    stats = await fs.stat(realPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        path: realPath,
        exists: false,
        changed: false,
        ownerFixed: false,
        modeFixed: false
      };
    }
    throw error;
  }

  const expected = resolveExpectedOwner();
  const currentMode = stats.mode & 0o777;
  let modeFixed = false;
  if (currentMode !== 0o600) {
    await fs.chmod(realPath, 0o600);
    modeFixed = true;
  }

  let ownerFixed = false;
  if (isRootRuntime() && expected) {
    if (stats.uid !== expected.uid || stats.gid !== expected.gid) {
      await fs.chown(realPath, expected.uid, expected.gid);
      ownerFixed = true;
    }
  }

  return {
    path: realPath,
    exists: true,
    changed: modeFixed || ownerFixed,
    ownerFixed,
    modeFixed
  };
}

async function loadOpenClawConfig(configPath) {
  return readJsonFile(expandHome(configPath), {});
}

async function saveOpenClawConfig(configPath, content) {
  const realPath = expandHome(configPath);
  const backupPath = `${realPath}.bak.${nowIso().replaceAll(":", "-")}`;
  try {
    await fs.copyFile(realPath, backupPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  await writeJsonFileAtomic(realPath, content, 0o600);
  const permissionSync = await ensureOpenClawConfigPermissions(realPath);
  return {
    path: realPath,
    backupPath,
    permissionSync
  };
}

export { ensureOpenClawConfigPermissions, loadOpenClawConfig, saveOpenClawConfig };
