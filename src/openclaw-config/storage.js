import fs from "node:fs/promises";
import { expandHome, nowIso, readJsonFile, writeJsonFileAtomic } from "../utils.js";

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
  return {
    path: realPath,
    backupPath
  };
}

export { loadOpenClawConfig, saveOpenClawConfig };
