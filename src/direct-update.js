import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_BOT_RELEASE_REPO = "openclaw/openclaw";
const DEFAULT_PANEL_RELEASE_REPO = "Bianshumeng/openclaw-panel-public";
const DEFAULT_PANEL_SERVICE_NAME = "openclaw-panel";
const DEFAULT_PANEL_APP_DIR = "/opt/openclaw-panel";

function trimText(value) {
  return String(value || "").trim();
}

function stripLeadingV(value) {
  return trimText(value).replace(/^v/i, "");
}

function normalizeTag(value) {
  const text = trimText(value);
  if (!text) {
    return "";
  }
  return text.startsWith("v") || text.startsWith("V") ? text : `v${text}`;
}

function normalizeRepo(value, fallbackRepo) {
  const text = trimText(value);
  if (!text) {
    return fallbackRepo;
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
    throw new Error(`发布仓库格式不合法：${text}（应为 owner/repo）`);
  }
  return text;
}

function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

function parseVersionFromText(value) {
  const text = trimText(value);
  if (!text) {
    return "";
  }
  const match = text.match(/([0-9]{4}\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z._-]+)?)/);
  if (match) {
    return stripLeadingV(match[1]);
  }
  return stripLeadingV(text.split(/\s+/)[0] || "");
}

function toInstallMethod(rawInstall = "") {
  const value = trimText(rawInstall).toLowerCase();
  if (!value) {
    return "global";
  }
  if (/(git|source|checkout|workspace|repo)/.test(value)) {
    return "source";
  }
  if (/(pnpm|npm|yarn|bun|global)/.test(value)) {
    return "global";
  }
  return "global";
}

export function parseOpenClawUpdateStatus(rawOutput = "") {
  const text = String(rawOutput || "");
  const installMatch = text.match(/│\s*Install\s*│\s*([^│\n]+)\s*│/i);
  const updateMatch = text.match(/│\s*Update\s*│\s*([^│\n]+)\s*│/i);
  const installRaw = trimText(installMatch?.[1] || "");
  const updateRaw = trimText(updateMatch?.[1] || "");

  const installMethod = toInstallMethod(installRaw);
  const strategy = installMethod === "source" ? "openclaw-update" : "package-manager";

  const hasAvailableKeyword = /available/i.test(updateRaw) || /update available/i.test(text);
  const hasUpToDateKeyword = /up[\s-]?to[\s-]?date/i.test(updateRaw) || /already up[\s-]?to[\s-]?date/i.test(text);
  let latestTag = "";
  const preferred = [updateRaw, text];
  const patterns = [
    /npm update\s+([0-9][0-9A-Za-z._-]*)/i,
    /latest(?:\s+version)?\s*[:：]?\s*([0-9][0-9A-Za-z._-]*)/i,
    /available[^\n]*\b([0-9]{4}\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z._-]+)?)/i,
    /([0-9]{4}\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z._-]+)?)/i
  ];
  for (const source of preferred) {
    if (!source) {
      continue;
    }
    for (const pattern of patterns) {
      const matched = source.match(pattern);
      if (matched && matched[1]) {
        latestTag = stripLeadingV(matched[1]);
        break;
      }
    }
    if (latestTag) {
      break;
    }
  }

  return {
    installRaw,
    updateRaw,
    installMethod,
    strategy,
    latestTag,
    updateAvailable: hasAvailableKeyword && !hasUpToDateKeyword
  };
}

async function fetchJson(url, { fetchImpl = fetch, githubToken = "" } = {}) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "openclaw-panel-updater"
  };
  const token = trimText(githubToken);
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetchImpl(url, { headers });
  const bodyText = await response.text();
  if (!response.ok) {
    const err = new Error(`GitHub API 请求失败: ${response.status}`);
    err.status = response.status;
    err.bodyText = bodyText;
    throw err;
  }
  try {
    return JSON.parse(bodyText);
  } catch (error) {
    throw new Error(`GitHub API 返回了非 JSON 内容: ${error.message}`);
  }
}

function parseReleasePayload(payload, releaseRepo) {
  const tag = trimText(payload?.tag_name || payload?.name);
  const tarballUrl = trimText(payload?.tarball_url || payload?.zipball_url);
  if (!tag || !tarballUrl) {
    throw new Error(`发布信息不完整（repo=${releaseRepo}）`);
  }
  return {
    tag,
    tarballUrl,
    publishedAt: trimText(payload?.published_at),
    htmlUrl: trimText(payload?.html_url),
    releaseRepo
  };
}

async function fetchLatestRelease({ releaseRepo, fetchImpl = fetch, githubToken = "" }) {
  const url = `https://api.github.com/repos/${releaseRepo}/releases/latest`;
  const payload = await fetchJson(url, { fetchImpl, githubToken });
  return parseReleasePayload(payload, releaseRepo);
}

async function fetchReleaseByTag({ releaseRepo, tag, fetchImpl = fetch, githubToken = "" }) {
  const normalized = trimText(tag);
  const candidates = [];
  if (normalized) {
    candidates.push(normalized);
    if (normalized.startsWith("v") || normalized.startsWith("V")) {
      candidates.push(normalized.slice(1));
    } else {
      candidates.push(`v${normalized}`);
    }
  }
  const deduped = [...new Set(candidates.map((item) => trimText(item)).filter(Boolean))];
  let lastError = null;
  for (const candidate of deduped) {
    try {
      const url = `https://api.github.com/repos/${releaseRepo}/releases/tags/${encodeURIComponent(candidate)}`;
      const payload = await fetchJson(url, { fetchImpl, githubToken });
      return parseReleasePayload(payload, releaseRepo);
    } catch (error) {
      if (Number(error?.status) === 404) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  if (lastError) {
    throw new Error(`未找到发布版本：${normalized}`);
  }
  throw new Error("缺少目标发布版本");
}

async function getCurrentOpenClawVersion({ runCmd }) {
  const result = await runCmd("openclaw", ["--version"], 15000);
  if (!result.ok) {
    throw new Error(result.stderr || result.message || "无法读取 openclaw 当前版本");
  }
  return parseVersionFromText(result.stdout);
}

export async function checkBotDirectUpdate({
  runCmd,
  releaseRepo = DEFAULT_BOT_RELEASE_REPO
} = {}) {
  if (typeof runCmd !== "function") {
    throw new Error("缺少 runCmd");
  }
  const currentTag = await getCurrentOpenClawVersion({ runCmd });
  const statusResult = await runCmd("openclaw", ["update", "status"], 30000);
  if (!statusResult.ok) {
    return {
      ok: true,
      currentTag,
      latestTag: "",
      updateAvailable: false,
      warning: statusResult.stderr || statusResult.message || "无法检查更新状态",
      installMethod: "global",
      strategy: "package-manager",
      releaseRepo
    };
  }
  const parsed = parseOpenClawUpdateStatus(statusResult.stdout);
  let updateAvailable = Boolean(parsed.updateAvailable);
  if (!updateAvailable && parsed.latestTag && currentTag) {
    updateAvailable = stripLeadingV(parsed.latestTag) !== stripLeadingV(currentTag);
  }
  return {
    ok: true,
    currentTag,
    latestTag: parsed.latestTag || "",
    updateAvailable,
    warning: "",
    installMethod: parsed.installMethod,
    strategy: parsed.strategy,
    releaseRepo
  };
}

async function runOpenClawPostChecks({ runCmd }) {
  const checks = [
    { name: "doctor", args: ["doctor"], timeout: 120000 },
    { name: "gateway restart", args: ["gateway", "restart"], timeout: 120000 },
    { name: "health", args: ["health"], timeout: 120000 }
  ];
  const warnings = [];
  for (const item of checks) {
    const result = await runCmd("openclaw", item.args, item.timeout);
    if (!result.ok) {
      warnings.push(`${item.name}: ${trimText(result.stderr || result.message || "失败")}`);
    }
  }
  return warnings;
}

export async function mutateBotDirectUpdate({
  action = "upgrade",
  tag = "",
  runCmd
} = {}) {
  if (typeof runCmd !== "function") {
    throw new Error("缺少 runCmd");
  }
  const targetTag = trimText(tag);
  if (action === "rollback" && !targetTag) {
    return {
      ok: false,
      action,
      rolledBack: false,
      message: "回滚必须提供目标版本号（tag）"
    };
  }
  const args = ["update", "--yes"];
  if (targetTag) {
    args.push("--tag", stripLeadingV(targetTag));
  }
  const result = await runCmd("openclaw", args, 20 * 60 * 1000);
  if (!result.ok) {
    return {
      ok: false,
      action,
      rolledBack: false,
      message: trimText(result.stderr || result.message || "OpenClaw 更新失败")
    };
  }
  const currentTag = await getCurrentOpenClawVersion({ runCmd }).catch(() => stripLeadingV(targetTag));
  const warnings = await runOpenClawPostChecks({ runCmd });
  const baseMessage = action === "rollback" ? "OpenClaw 回滚成功" : "OpenClaw 更新成功";
  const warningMessage = warnings.length > 0 ? `；后置检查告警：${warnings.join(" | ")}` : "";
  return {
    ok: true,
    action,
    targetImage: currentTag ? `openclaw:${currentTag}` : `openclaw:${stripLeadingV(targetTag) || "latest"}`,
    oldImage: "",
    rolledBack: false,
    requiresRestart: false,
    message: `${baseMessage}${warningMessage}`
  };
}

function resolvePanelAppDir(value = "") {
  const configured = trimText(value || process.env.PANEL_APP_DIR);
  if (configured) {
    return path.resolve(configured);
  }
  if (process.platform === "linux") {
    return DEFAULT_PANEL_APP_DIR;
  }
  return process.cwd();
}

function resolvePanelServiceName(value = "") {
  return trimText(value || process.env.PANEL_SERVICE_NAME) || DEFAULT_PANEL_SERVICE_NAME;
}

function resolvePanelUpdateStateDir(value = "") {
  const configured = trimText(value || process.env.PANEL_UPDATE_STATE_DIR);
  if (configured) {
    return path.resolve(configured);
  }
  if (process.platform === "linux") {
    return "/var/lib/openclaw-panel/update";
  }
  return path.join(os.tmpdir(), "openclaw-panel-update");
}

async function readJsonFileSafe(filePath, fallbackValue = {}) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return fallbackValue;
  }
}

async function readPanelCurrentVersion(appDir) {
  const markerPath = path.join(appDir, ".panel-release.json");
  const marker = await readJsonFileSafe(markerPath, {});
  const markerTag = trimText(marker?.tag);
  if (markerTag) {
    return markerTag;
  }
  const packageJsonPath = path.join(appDir, "package.json");
  const packageJson = await readJsonFileSafe(packageJsonPath, {});
  const packageVersion = trimText(packageJson?.version);
  if (packageVersion) {
    return normalizeTag(packageVersion);
  }
  return "";
}

async function downloadTarball(tarballUrl, destinationPath, { fetchImpl = fetch, githubToken = "" } = {}) {
  const headers = {
    accept: "application/octet-stream",
    "user-agent": "openclaw-panel-updater"
  };
  const token = trimText(githubToken);
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetchImpl(tarballUrl, { headers });
  if (!response.ok) {
    throw new Error(`下载发布包失败: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destinationPath, buffer, { mode: 0o600 });
}

function safeTagForFilename(tag) {
  return trimText(tag).replace(/[^0-9A-Za-z._-]/g, "_");
}

function buildApplyScript({
  appDir,
  serviceName,
  tarballPath,
  tag,
  releaseRepo,
  pendingPath
}) {
  const markerPath = path.join(appDir, ".panel-release.json");
  const markerPayload = JSON.stringify(
    {
      tag,
      releaseRepo,
      appliedAt: new Date().toISOString()
    },
    null,
    2
  );
  return [
    "set -euo pipefail",
    `APP_DIR=${shellQuote(appDir)}`,
    `SERVICE_NAME=${shellQuote(serviceName)}`,
    `TARBALL=${shellQuote(tarballPath)}`,
    `PENDING=${shellQuote(pendingPath)}`,
    "TMP_DIR=$(mktemp -d)",
    "cleanup(){ rm -rf \"$TMP_DIR\"; }",
    "trap cleanup EXIT",
    "tar -xzf \"$TARBALL\" -C \"$TMP_DIR\"",
    "SRC_DIR=$(find \"$TMP_DIR\" -mindepth 1 -maxdepth 1 -type d | head -n 1)",
    "if [ -z \"$SRC_DIR\" ]; then echo 'release unpack failed'; exit 1; fi",
    "mkdir -p \"$APP_DIR\"",
    "if command -v rsync >/dev/null 2>&1; then",
    "  rsync -a --delete --exclude '.git' --exclude 'node_modules' --exclude '.runtime' \"$SRC_DIR\"/ \"$APP_DIR\"/",
    "else",
    "  find \"$APP_DIR\" -mindepth 1 -maxdepth 1 ! -name '.runtime' -exec rm -rf {} +",
    "  cp -a \"$SRC_DIR\"/. \"$APP_DIR\"/",
    "fi",
    "cd \"$APP_DIR\"",
    "npm install --omit=dev",
    `cat > ${shellQuote(markerPath)} <<'JSON'`,
    markerPayload,
    "JSON",
    "rm -f \"$PENDING\"",
    "systemctl daemon-reload || true",
    "systemctl restart \"$SERVICE_NAME\""
  ].join("\n");
}

export async function checkPanelDirectUpdate({
  releaseRepo = DEFAULT_PANEL_RELEASE_REPO,
  githubToken = "",
  fetchImpl = fetch,
  appDir = ""
} = {}) {
  const finalRepo = normalizeRepo(releaseRepo, DEFAULT_PANEL_RELEASE_REPO);
  const finalAppDir = resolvePanelAppDir(appDir);
  const currentTag = await readPanelCurrentVersion(finalAppDir);
  try {
    const latest = await fetchLatestRelease({ releaseRepo: finalRepo, fetchImpl, githubToken });
    const updateAvailable = currentTag ? stripLeadingV(currentTag) !== stripLeadingV(latest.tag) : true;
    return {
      ok: true,
      currentTag,
      latestTag: latest.tag,
      latestPublishedAt: latest.publishedAt,
      releaseRepo: finalRepo,
      updateAvailable,
      warning: ""
    };
  } catch (error) {
    return {
      ok: true,
      currentTag,
      latestTag: "",
      latestPublishedAt: null,
      releaseRepo: finalRepo,
      updateAvailable: false,
      warning: error.message || String(error)
    };
  }
}

export async function stagePanelDirectUpdate({
  tag = "",
  releaseRepo = DEFAULT_PANEL_RELEASE_REPO,
  githubToken = "",
  fetchImpl = fetch,
  appDir = "",
  stateDir = ""
} = {}) {
  const finalRepo = normalizeRepo(releaseRepo, DEFAULT_PANEL_RELEASE_REPO);
  const finalAppDir = resolvePanelAppDir(appDir);
  const finalStateDir = resolvePanelUpdateStateDir(stateDir);
  await fs.mkdir(finalStateDir, { recursive: true });
  const release = trimText(tag)
    ? await fetchReleaseByTag({ releaseRepo: finalRepo, tag, fetchImpl, githubToken })
    : await fetchLatestRelease({ releaseRepo: finalRepo, fetchImpl, githubToken });
  const currentTag = await readPanelCurrentVersion(finalAppDir);
  const archiveName = `panel-${safeTagForFilename(release.tag)}.tar.gz`;
  const tarballPath = path.join(finalStateDir, archiveName);
  await downloadTarball(release.tarballUrl, tarballPath, { fetchImpl, githubToken });
  const pendingPath = path.join(finalStateDir, "pending.json");
  const pendingPayload = {
    tag: release.tag,
    releaseRepo: finalRepo,
    appDir: finalAppDir,
    tarballPath,
    stagedAt: new Date().toISOString(),
    publishedAt: release.publishedAt
  };
  await fs.writeFile(pendingPath, `${JSON.stringify(pendingPayload, null, 2)}\n`, { mode: 0o600 });
  return {
    ok: true,
    action: "stage",
    targetImage: `panel:${release.tag}`,
    oldImage: currentTag ? `panel:${currentTag}` : "",
    rolledBack: false,
    requiresRestart: true,
    message: `已准备版本包 ${release.tag}，请点击“应用更新并重启”生效。`
  };
}

export async function applyPanelDirectUpdate({
  tag = "",
  releaseRepo = DEFAULT_PANEL_RELEASE_REPO,
  githubToken = "",
  fetchImpl = fetch,
  appDir = "",
  stateDir = "",
  panelServiceName = ""
} = {}) {
  if (process.platform !== "linux") {
    return {
      ok: false,
      action: "apply",
      rolledBack: false,
      requiresReconnect: false,
      message: "控制台自更新仅支持 Linux 服务器环境执行"
    };
  }
  const finalStateDir = resolvePanelUpdateStateDir(stateDir);
  await fs.mkdir(finalStateDir, { recursive: true });
  const pendingPath = path.join(finalStateDir, "pending.json");
  let pending = await readJsonFileSafe(pendingPath, null);
  if (!pending || !trimText(pending?.tarballPath)) {
    if (!trimText(tag)) {
      return {
        ok: false,
        action: "apply",
        rolledBack: false,
        requiresReconnect: false,
        message: "未找到待应用的版本包，请先执行“检查新版本/准备更新包”"
      };
    }
    await stagePanelDirectUpdate({
      tag,
      releaseRepo,
      githubToken,
      fetchImpl,
      appDir,
      stateDir: finalStateDir
    });
    pending = await readJsonFileSafe(pendingPath, null);
  }
  if (!pending || !trimText(pending?.tarballPath)) {
    return {
      ok: false,
      action: "apply",
      rolledBack: false,
      requiresReconnect: false,
      message: "未找到待应用的版本包"
    };
  }
  const finalAppDir = resolvePanelAppDir(trimText(pending?.appDir) || appDir);
  const finalServiceName = resolvePanelServiceName(panelServiceName);
  const finalTag = trimText(pending?.tag) || normalizeTag(tag) || "unknown";
  const finalRepo = normalizeRepo(trimText(pending?.releaseRepo) || releaseRepo, DEFAULT_PANEL_RELEASE_REPO);
  const script = buildApplyScript({
    appDir: finalAppDir,
    serviceName: finalServiceName,
    tarballPath: trimText(pending.tarballPath),
    tag: finalTag,
    releaseRepo: finalRepo,
    pendingPath
  });
  const logPath = path.join(finalStateDir, `apply-${Date.now()}.log`);
  const wrapper = `${script}\n`;
  const child = spawn("bash", ["-lc", `(${wrapper}) > ${shellQuote(logPath)} 2>&1`], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  const currentTag = await readPanelCurrentVersion(finalAppDir);
  return {
    ok: true,
    action: "apply",
    targetImage: `panel:${finalTag}`,
    oldImage: currentTag ? `panel:${currentTag}` : "",
    rolledBack: false,
    requiresReconnect: true,
    reconnectAfterMs: 12000,
    message: `已开始应用 ${finalTag} 并重启控制台服务，页面将短暂断开后恢复。`,
    logPath
  };
}
