import { build, transform } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const runtimeRoot = path.join(rootDir, ".runtime");
const runtimePublicDir = path.join(runtimeRoot, "public");
const runtimeSrcDir = path.join(runtimeRoot, "src");

function shouldMinifyJs(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (!normalized.endsWith(".js")) {
    return false;
  }
  // Keep vendor bundles untouched to avoid breaking third-party behavior.
  return !normalized.includes("/shoelace/");
}

async function minifyJsFile(sourcePath, targetPath) {
  const source = await fs.readFile(sourcePath, "utf8");
  const result = await transform(source, {
    loader: "js",
    minify: true,
    legalComments: "none",
    target: "es2020",
    charset: "utf8",
    drop: ["debugger"]
  });
  await fs.writeFile(targetPath, result.code, "utf8");
}

async function copyPublicTree(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyPublicTree(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile() && shouldMinifyJs(sourcePath)) {
      await minifyJsFile(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function bundleServer() {
  await fs.mkdir(runtimeSrcDir, { recursive: true });
  await build({
    entryPoints: [path.join(rootDir, "src", "server.js")],
    outfile: path.join(runtimeSrcDir, "server.js"),
    bundle: true,
    minify: true,
    legalComments: "none",
    platform: "node",
    format: "esm",
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module';const require=__createRequire(import.meta.url);"
    },
    target: "node22",
    sourcemap: false,
    logLevel: "info"
  });
}

async function main() {
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  await fs.mkdir(runtimeRoot, { recursive: true });
  await Promise.all([bundleServer(), copyPublicTree(publicDir, runtimePublicDir)]);
  console.log(`runtime build complete: ${runtimeRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
