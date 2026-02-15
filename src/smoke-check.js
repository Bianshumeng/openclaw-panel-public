import { loadPanelConfig } from "./panel-config.js";
import { loadOpenClawConfig, extractSettings } from "./openclaw-config.js";

async function run() {
  const { config, filePath } = await loadPanelConfig();
  console.log(`[ok] panel config path: ${filePath}`);
  const openclaw = await loadOpenClawConfig(config.openclaw.config_path);
  const settings = extractSettings(openclaw);
  console.log(`[ok] provider: ${settings.model.providerId}/${settings.model.modelId}`);
  console.log("[ok] smoke check done");
}

run().catch((error) => {
  console.error(`[fail] ${error.message}`);
  process.exit(1);
});
