import assert from "node:assert/strict";
import test from "node:test";
import { getSkillConfig, listSkillsStatus, setSkillEnabled } from "../../src/skills-service.js";

test("listSkillsStatus normalizes skills payload", async () => {
  const result = await listSkillsStatus({
    panelConfig: { openclaw: { config_path: "/tmp/openclaw.json" } },
    deps: {
      callGatewayRpc: async ({ method }) => {
        assert.equal(method, "skills.status");
        return {
          workspaceDir: "/workspace",
          managedSkillsDir: "/skills",
          skills: [
            {
              skillKey: "skill-a",
              name: "Skill A",
              updatedAt: "2026-02-16T18:00:00Z",
              disabled: false,
              eligible: true,
              blockedByAllowlist: false
            },
            {
              skillKey: "skill-b",
              name: "Skill B",
              disabled: true,
              eligible: false,
              blockedByAllowlist: true
            }
          ]
        };
      }
    }
  });

  assert.equal(result.total, 2);
  assert.equal(result.enabled, 1);
  assert.equal(result.disabled, 1);
  assert.equal(result.skills[0].key, "skill-a");
  assert.equal(result.skills[0].updatedAt, "2026-02-16T18:00:00Z");
  assert.equal(result.skills[1].blocked, true);
});

test("setSkillEnabled rejects unknown skill key", async () => {
  await assert.rejects(
    setSkillEnabled({
      panelConfig: { openclaw: { config_path: "/tmp/openclaw.json" } },
      skillKey: "missing-skill",
      enabled: true,
      deps: {
        callGatewayRpc: async ({ method }) => {
          if (method === "skills.status") {
            return {
              skills: [{ skillKey: "skill-a", name: "Skill A", disabled: false }]
            };
          }
          throw new Error(`unexpected method: ${method}`);
        }
      }
    }),
    /未知技能/
  );
});

test("setSkillEnabled updates existing skill and reads masked config", async () => {
  const callTrace = [];
  const result = await setSkillEnabled({
    panelConfig: { openclaw: { config_path: "/tmp/openclaw.json" } },
    skillKey: "skill-a",
    enabled: false,
    deps: {
      callGatewayRpc: async ({ method, params }) => {
        callTrace.push({ method, params });
        if (method === "skills.status") {
          return {
            skills: [{ skillKey: "skill-a", name: "Skill A", disabled: false }]
          };
        }
        if (method === "skills.update") {
          return { ok: true };
        }
        throw new Error(`unexpected method: ${method}`);
      },
      loadOpenClawConfig: async () => ({
        skills: {
          entries: {
            "skill-a": {
              enabled: false,
              apiKey: "abcde12345",
              env: {
                FOO: "bar"
              }
            }
          }
        }
      })
    }
  });

  assert.deepEqual(
    callTrace.map((item) => item.method),
    ["skills.status", "skills.update"]
  );
  assert.equal(result.skillKey, "skill-a");
  assert.equal(result.enabled, false);
  assert.equal(result.config.enabled, false);
  assert.equal(result.config.hasApiKey, true);
  assert.match(result.config.apiKeyMasked, /^\*+/);
  assert.equal(result.config.env.FOO, "***");
});

test("getSkillConfig returns empty defaults for missing skill entry", async () => {
  const result = await getSkillConfig({
    panelConfig: { openclaw: { config_path: "/tmp/openclaw.json" } },
    skillKey: "skill-x",
    deps: {
      loadOpenClawConfig: async () => ({})
    }
  });

  assert.equal(result.skillKey, "skill-x");
  assert.equal(result.enabled, null);
  assert.equal(result.hasApiKey, false);
  assert.equal(result.apiKeyMasked, "");
});
