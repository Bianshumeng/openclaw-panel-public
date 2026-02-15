import test from "node:test";
import assert from "node:assert/strict";
import { isKnownPanelPath, panelByPath } from "../../public/app-routes.js";

test("panelByPath maps known routes", () => {
  assert.equal(panelByPath("/dashboard"), "panel-dashboard");
  assert.equal(panelByPath("/model"), "panel-model");
  assert.equal(panelByPath("/config-generator"), "panel-config-generator");
  assert.equal(panelByPath("/channels"), "panel-channel");
  assert.equal(panelByPath("/update"), "panel-update");
  assert.equal(panelByPath("/service"), "panel-service");
  assert.equal(panelByPath("/logs"), "panel-logs");
});

test("panelByPath falls back to model for unknown path", () => {
  assert.equal(panelByPath("/unknown"), "panel-model");
  assert.equal(panelByPath(""), "panel-model");
  assert.equal(panelByPath("/"), "panel-model");
});

test("isKnownPanelPath validates route list", () => {
  assert.equal(isKnownPanelPath("/"), true);
  assert.equal(isKnownPanelPath("/dashboard"), true);
  assert.equal(isKnownPanelPath("/logs"), true);
  assert.equal(isKnownPanelPath("/nothing"), false);
});
