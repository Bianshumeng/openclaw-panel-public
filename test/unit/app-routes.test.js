import test from "node:test";
import assert from "node:assert/strict";
import { isKnownPanelPath, panelByPath } from "../../public/app-routes.js";

test("panelByPath maps known routes", () => {
  assert.equal(panelByPath("/dashboard"), "panel-dashboard");
  assert.equal(panelByPath("/status-overview"), "panel-dashboard");
  assert.equal(panelByPath("/model"), "panel-model");
  assert.equal(panelByPath("/model/add"), "panel-model-add");
  assert.equal(panelByPath("/config-generator"), "panel-config-generator");
  assert.equal(panelByPath("/channels"), "panel-channel");
  assert.equal(panelByPath("/channels/telegram"), "panel-channel");
  assert.equal(panelByPath("/channels/feishu"), "panel-channel");
  assert.equal(panelByPath("/channels/discord"), "panel-channel");
  assert.equal(panelByPath("/channels/slack"), "panel-channel");
  assert.equal(panelByPath("/update"), "panel-update");
  assert.equal(panelByPath("/service"), "panel-service");
  assert.equal(panelByPath("/logs"), "panel-logs");
});

test("panelByPath falls back to dashboard for unknown path", () => {
  assert.equal(panelByPath("/unknown"), "panel-dashboard");
  assert.equal(panelByPath(""), "panel-dashboard");
  assert.equal(panelByPath("/"), "panel-dashboard");
});

test("isKnownPanelPath validates route list", () => {
  assert.equal(isKnownPanelPath("/"), true);
  assert.equal(isKnownPanelPath("/dashboard"), true);
  assert.equal(isKnownPanelPath("/status-overview"), true);
  assert.equal(isKnownPanelPath("/model/add"), true);
  assert.equal(isKnownPanelPath("/channels/telegram"), true);
  assert.equal(isKnownPanelPath("/channels/feishu"), true);
  assert.equal(isKnownPanelPath("/channels/discord"), true);
  assert.equal(isKnownPanelPath("/channels/slack"), true);
  assert.equal(isKnownPanelPath("/logs"), true);
  assert.equal(isKnownPanelPath("/nothing"), false);
});
