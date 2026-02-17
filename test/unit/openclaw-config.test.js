import test from "node:test";
import assert from "node:assert/strict";
import { applySettings, extractSettings } from "../../src/openclaw-config.js";

function makeBasePayload(overrides = {}) {
  return {
    model: {
      primary: "aicodecat-gpt/gpt-5.2",
      providerId: "aicodecat-gpt",
      providerApi: "openai-responses",
      providerBaseUrl: "https://aicode.cat/v1",
      providerApiKey: "",
      modelId: "gpt-5.2",
      modelName: "GPT-5.2",
      contextWindow: 400000,
      maxTokens: 128000,
      providerModels: []
    },
    channels: {
      telegram: {
        enabled: false,
        botToken: "",
        dmPolicy: "pairing",
        allowFrom: "",
        groupPolicy: "allowlist",
        groupAllowFrom: "",
        requireMention: true,
        streamMode: "partial"
      },
      feishu: {
        enabled: false,
        appId: "",
        appSecret: "",
        domain: "feishu",
        connectionMode: "websocket",
        dmPolicy: "pairing",
        allowFrom: "",
        groupPolicy: "allowlist",
        groupAllowFrom: "",
        requireMention: true
      },
      discord: {
        enabled: false,
        token: "",
        dmPolicy: "pairing",
        allowFrom: "",
        groupPolicy: "allowlist",
        allowBots: false,
        requireMention: true
      },
      slack: {
        enabled: false,
        mode: "socket",
        botToken: "",
        appToken: "",
        signingSecret: "",
        dmPolicy: "pairing",
        allowFrom: "",
        groupPolicy: "allowlist",
        allowBots: false,
        requireMention: true
      }
    },
    ...overrides
  };
}

test("applySettings keeps existing model advanced fields when editing single model", () => {
  const current = {
    models: {
      providers: {
        "aicodecat-gpt": {
          baseUrl: "https://aicode.cat/v1",
          apiKey: "sk-old",
          api: "openai-responses",
          models: [
            {
              id: "gpt-5.2",
              name: "GPT-5.2",
              reasoning: true,
              input: ["text", "image"],
              cost: { input: 1.75, output: 14 },
              contextWindow: 400000,
              maxTokens: 128000
            }
          ]
        }
      }
    },
    agents: {
      defaults: {
        model: {
          primary: "aicodecat-gpt/gpt-5.2"
        }
      }
    },
    channels: {}
  };

  const next = applySettings(
    current,
    makeBasePayload({
      model: {
        primary: "aicodecat-gpt/gpt-5.2",
        providerId: "aicodecat-gpt",
        providerApi: "openai-responses",
        providerBaseUrl: "https://aicode.cat/v1",
        providerApiKey: "",
        modelId: "gpt-5.2",
        modelName: "GPT-5.2 New Label",
        contextWindow: 500000,
        maxTokens: 120000,
        providerModels: []
      }
    })
  );

  const model = next.models.providers["aicodecat-gpt"].models.find((item) => item.id === "gpt-5.2");
  assert.equal(model.name, "GPT-5.2 New Label");
  assert.equal(model.reasoning, true);
  assert.deepEqual(model.input, ["text", "image"]);
  assert.deepEqual(model.cost, { input: 1.75, output: 14 });
  assert.equal(model.contextWindow, 500000);
  assert.equal(model.maxTokens, 120000);
});

test("applySettings upserts providerModels list without dropping existing untouched models", () => {
  const current = {
    models: {
      providers: {
        "aicodecat-claude": {
          baseUrl: "https://aicode.cat",
          apiKey: "sk-old",
          api: "anthropic-messages",
          models: [
            {
              id: "claude-sonnet-4-5-20250929",
              name: "Claude Sonnet 4.5",
              reasoning: true,
              input: ["text", "image"],
              contextWindow: 200000,
              maxTokens: 64000
            }
          ]
        }
      }
    },
    agents: {
      defaults: {
        model: {
          primary: "aicodecat-claude/claude-sonnet-4-5-20250929"
        }
      }
    },
    channels: {}
  };

  const next = applySettings(
    current,
    makeBasePayload({
      model: {
        primary: "aicodecat-claude/claude-opus-4-6",
        providerId: "aicodecat-claude",
        providerApi: "anthropic-messages",
        providerBaseUrl: "https://aicode.cat",
        providerApiKey: "sk-new",
        modelId: "claude-opus-4-6",
        modelName: "Claude Opus 4.6",
        contextWindow: 200000,
        maxTokens: 64000,
        providerModels: [
          {
            id: "claude-opus-4-6",
            name: "Claude Opus 4.6",
            reasoning: true,
            input: ["text", "image"],
            contextWindow: 200000,
            maxTokens: 64000
          },
          {
            id: "claude-haiku-4-5",
            name: "Claude Haiku 4.5",
            reasoning: true,
            input: ["text", "image"],
            contextWindow: 200000,
            maxTokens: 64000
          }
        ]
      }
    })
  );

  assert.equal(next.agents.defaults.model.primary, "aicodecat-claude/claude-opus-4-6");
  assert.equal(next.models.providers["aicodecat-claude"].apiKey, "sk-new");
  assert.equal(next.models.providers["aicodecat-claude"].models.length, 3);
  assert.ok(next.models.providers["aicodecat-claude"].models.some((item) => item.id === "claude-sonnet-4-5-20250929"));
  assert.ok(next.models.providers["aicodecat-claude"].models.some((item) => item.id === "claude-opus-4-6"));
  assert.ok(next.models.providers["aicodecat-claude"].models.some((item) => item.id === "claude-haiku-4-5"));
});

test("extractSettings returns model catalog for UI selection", () => {
  const settings = extractSettings({
    models: {
      providers: {
        "aicodecat-gpt": {
          api: "openai-responses",
          baseUrl: "https://aicode.cat/v1",
          models: [
            {
              id: "gpt-5.3-codex",
              name: "GPT-5.3 Codex",
              contextWindow: 400000,
              maxTokens: 128000
            }
          ]
        }
      }
    },
    agents: {
      defaults: {
        thinkingDefault: "high",
        model: {
          primary: "aicodecat-gpt/gpt-5.3-codex"
        }
      }
    },
    channels: {}
  });

  assert.equal(settings.model.primary, "aicodecat-gpt/gpt-5.3-codex");
  assert.equal(settings.model.thinkingStrength, "high");
  assert.equal(settings.model.catalog.providers.length, 1);
  assert.equal(settings.model.catalog.modelRefs.length, 1);
  assert.equal(settings.model.catalog.modelRefs[0].ref, "aicodecat-gpt/gpt-5.3-codex");
  assert.equal(settings.model.catalog.modelRefs[0].thinkingStrength, "high");
  assert.equal(settings.model.catalog.providers[0].models[0].thinkingStrength, "high");
});

test("extractSettings does not synthesize fake model when config has no providers", () => {
  const settings = extractSettings({
    models: {
      providers: {},
      mode: "merge"
    },
    agents: {
      defaults: {
        model: {
          primary: ""
        }
      }
    },
    channels: {}
  });

  assert.equal(settings.model.primary, "");
  assert.equal(settings.model.providerId, "");
  assert.equal(settings.model.providerApi, "");
  assert.equal(settings.model.providerBaseUrl, "");
  assert.equal(settings.model.modelId, "");
  assert.equal(settings.model.modelName, "");
  assert.equal(settings.model.contextWindow, undefined);
  assert.equal(settings.model.maxTokens, undefined);
  assert.equal(settings.model.catalog.providers.length, 0);
  assert.equal(settings.model.catalog.modelRefs.length, 0);
});

test("applySettings supports model-only payload without mutating channels", () => {
  const current = {
    models: {
      providers: {
        "aicodecat-gpt": {
          baseUrl: "https://aicode.cat/v1",
          apiKey: "sk-old",
          api: "openai-responses",
          models: [
            {
              id: "gpt-5.2",
              name: "GPT-5.2",
              contextWindow: 400000,
              maxTokens: 128000
            }
          ]
        }
      }
    },
    agents: {
      defaults: {
        model: {
          primary: "aicodecat-gpt/gpt-5.2"
        }
      }
    },
    channels: {
      telegram: {
        enabled: true,
        dmPolicy: "pairing",
        allowFrom: ["u1"],
        groupPolicy: "allowlist",
        groupAllowFrom: [],
        streamMode: "partial",
        groups: {
          "*": {
            requireMention: true
          }
        },
        botToken: "token-old",
        token: "token-old"
      }
    }
  };

  const next = applySettings(current, {
    model: {
      primary: "aicodecat-gpt/gpt-5.2",
      providerId: "aicodecat-gpt",
      providerApi: "openai-responses",
      providerBaseUrl: "https://aicode.cat/v1",
      providerApiKey: "",
      modelId: "gpt-5.2",
      modelName: "GPT-5.2",
      contextWindow: 400000,
      maxTokens: 128000,
      providerModels: []
    }
  });

  assert.deepEqual(next.channels, current.channels);
});

test("extractSettings reads telegram advanced fields from official config shape", () => {
  const settings = extractSettings({
    models: {
      providers: {
        "aicodecat-gpt": {
          api: "openai-responses",
          baseUrl: "https://aicode.cat/v1",
          models: [{ id: "gpt-5.2", name: "GPT-5.2" }]
        }
      }
    },
    agents: {
      defaults: {
        model: {
          primary: "aicodecat-gpt/gpt-5.2"
        }
      }
    },
    channels: {
      telegram: {
        enabled: true,
        botToken: "token-value",
        tokenFile: "/run/secrets/tg_token",
        dmPolicy: "allowlist",
        allowFrom: ["10001"],
        groupPolicy: "open",
        groupAllowFrom: ["10001"],
        streamMode: "block",
        chunkMode: "newline",
        textChunkLimit: 3500,
        replyToMode: "all",
        linkPreview: false,
        blockStreaming: true,
        timeoutSeconds: 120,
        mediaMaxMb: 8,
        dmHistoryLimit: 20,
        historyLimit: 60,
        webhookUrl: "https://example.com/telegram",
        webhookSecret: "wh-secret",
        webhookPath: "/telegram-webhook",
        proxy: "socks5://127.0.0.1:1080",
        configWrites: false,
        reactionLevel: "ack",
        reactionNotifications: "all",
        capabilities: {
          inlineButtons: "group"
        },
        actions: {
          sendMessage: false,
          reactions: false,
          deleteMessage: true,
          sticker: true
        },
        network: {
          autoSelectFamily: false
        },
        retry: {
          attempts: 6,
          minDelayMs: 300,
          maxDelayMs: 2500,
          jitter: 0.2
        },
        commands: {
          native: "auto"
        },
        groups: {
          "*": {
            requireMention: false
          }
        },
        accounts: {
          main: {
            botToken: "x"
          }
        },
        customCommands: [{ command: "backup", description: "Git 备份" }],
        draftChunk: {
          minChars: 200,
          maxChars: 900,
          breakPreference: "paragraph"
        }
      }
    }
  });

  const tg = settings.channels.telegram;
  assert.equal(tg.enabled, true);
  assert.equal(tg.tokenFile, "/run/secrets/tg_token");
  assert.equal(tg.chunkMode, "newline");
  assert.equal(tg.textChunkLimit, 3500);
  assert.equal(tg.replyToMode, "all");
  assert.equal(tg.linkPreview, false);
  assert.equal(tg.configWrites, false);
  assert.equal(tg.inlineButtons, "group");
  assert.equal(tg.actionSendMessage, false);
  assert.equal(tg.actionReactions, false);
  assert.equal(tg.actionSticker, true);
  assert.equal(tg.networkAutoSelectFamily, false);
  assert.equal(tg.retryAttempts, 6);
  assert.equal(tg.retryJitter, 0.2);
  assert.equal(tg.commandsNative, "auto");
  assert.match(tg.groupsJson, /\*"/);
  assert.match(tg.customCommandsJson, /backup/);
});

test("extractSettings keeps retryJitter null for legacy non-numeric values", () => {
  const legacyJitterValues = [true, false, null, "0.6"];
  for (const jitter of legacyJitterValues) {
    const settings = extractSettings({
      models: {
        providers: {
          "aicodecat-gpt": {
            api: "openai-responses",
            baseUrl: "https://aicode.cat/v1",
            models: [{ id: "gpt-5.2", name: "GPT-5.2" }]
          }
        }
      },
      agents: {
        defaults: {
          model: {
            primary: "aicodecat-gpt/gpt-5.2"
          }
        }
      },
      channels: {
        telegram: {
          retry: {
            jitter
          }
        }
      }
    });

    assert.equal(settings.channels.telegram.retryJitter, null);
  }
});

test("load-save cycle does not coerce legacy boolean jitter into numeric extremes", () => {
  const current = {
    models: {
      providers: {
        "aicodecat-gpt": {
          baseUrl: "https://aicode.cat/v1",
          api: "openai-responses",
          models: [{ id: "gpt-5.2", name: "GPT-5.2" }]
        }
      }
    },
    agents: {
      defaults: {
        model: {
          primary: "aicodecat-gpt/gpt-5.2"
        }
      }
    },
    channels: {
      telegram: {
        retry: {
          attempts: 6,
          jitter: true
        }
      }
    }
  };

  const extracted = extractSettings(current);
  assert.equal(extracted.channels.telegram.retryJitter, null);

  const next = applySettings(current, extracted);
  assert.equal(next.channels.telegram.retry.attempts, 6);
  assert.equal("jitter" in next.channels.telegram.retry, false);
});

test("applySettings writes telegram advanced fields and json overrides", () => {
  const next = applySettings(
    {
      models: {
        providers: {
          "aicodecat-gpt": {
            baseUrl: "https://aicode.cat/v1",
            api: "openai-responses",
            models: [{ id: "gpt-5.2", name: "GPT-5.2" }]
          }
        }
      },
      agents: {
        defaults: {
          model: {
            primary: "aicodecat-gpt/gpt-5.2"
          }
        }
      },
      channels: {
        telegram: {
          enabled: true,
          botToken: "token-old",
          token: "token-old"
        }
      }
    },
    makeBasePayload({
      channels: {
        telegram: {
          enabled: true,
          botToken: "token-new",
          tokenFile: "/run/secrets/tg_token",
          dmPolicy: "allowlist",
          allowFrom: "10001",
          groupPolicy: "open",
          groupAllowFrom: "10001",
          requireMention: false,
          streamMode: "partial",
          chunkMode: "newline",
          textChunkLimit: 3000,
          replyToMode: "first",
          linkPreview: false,
          blockStreaming: true,
          timeoutSeconds: 180,
          mediaMaxMb: 10,
          dmHistoryLimit: 0,
          historyLimit: 100,
          webhookUrl: "https://example.com/telegram-webhook",
          webhookSecret: "wh-secret",
          webhookPath: "/tg-hook",
          proxy: "socks5://127.0.0.1:1080",
          configWrites: false,
          reactionLevel: "minimal",
          reactionNotifications: "all",
          inlineButtons: "all",
          actionSendMessage: true,
          actionReactions: true,
          actionDeleteMessage: false,
          actionSticker: true,
          networkAutoSelectFamily: true,
          retryAttempts: 7,
          retryMinDelayMs: 500,
          retryMaxDelayMs: 3500,
          retryJitter: 0.25,
          commandsNative: "false",
          groupsJson: "{\"*\":{\"requireMention\":false}}",
          accountsJson: "{\"main\":{\"botToken\":\"abc\"}}",
          customCommandsJson: "[{\"command\":\"backup\",\"description\":\"备份\"}]",
          draftChunkJson: "{\"minChars\":200,\"maxChars\":900}"
        },
        feishu: {
          enabled: false,
          appId: "",
          appSecret: "",
          domain: "feishu",
          connectionMode: "websocket",
          dmPolicy: "pairing",
          allowFrom: "",
          groupPolicy: "allowlist",
          groupAllowFrom: "",
          requireMention: true
        },
        discord: {
          enabled: false,
          token: "",
          dmPolicy: "pairing",
          allowFrom: "",
          groupPolicy: "allowlist",
          allowBots: false,
          requireMention: true
        },
        slack: {
          enabled: false,
          mode: "socket",
          botToken: "",
          appToken: "",
          signingSecret: "",
          dmPolicy: "pairing",
          allowFrom: "",
          groupPolicy: "allowlist",
          allowBots: false,
          requireMention: true
        }
      }
    })
  );

  const tg = next.channels.telegram;
  assert.equal(tg.tokenFile, "/run/secrets/tg_token");
  assert.equal(tg.chunkMode, "newline");
  assert.equal(tg.textChunkLimit, 3000);
  assert.equal(tg.replyToMode, "first");
  assert.equal(tg.linkPreview, false);
  assert.equal(tg.blockStreaming, true);
  assert.equal(tg.dmHistoryLimit, 0);
  assert.equal(tg.historyLimit, 100);
  assert.equal(tg.capabilities.inlineButtons, "all");
  assert.equal(tg.actions.deleteMessage, false);
  assert.equal(tg.actions.sticker, true);
  assert.equal(tg.network.autoSelectFamily, true);
  assert.equal(tg.retry.attempts, 7);
  assert.equal(tg.retry.jitter, 0.25);
  assert.equal(tg.commands.native, false);
  assert.equal(tg.botToken, "token-new");
  assert.equal(tg.token, "token-new");
  assert.equal(Array.isArray(tg.customCommands), true);
});

test("applySettings preserves telegram capabilities object while updating inlineButtons", () => {
  const current = {
    models: {
      providers: {
        "aicodecat-gpt": {
          baseUrl: "https://aicode.cat/v1",
          api: "openai-responses",
          models: [{ id: "gpt-5.2", name: "GPT-5.2" }]
        }
      }
    },
    agents: {
      defaults: {
        model: {
          primary: "aicodecat-gpt/gpt-5.2"
        }
      }
    },
    channels: {
      telegram: {
        capabilities: {
          inlineButtons: "group",
          richMedia: true
        }
      }
    }
  };

  const next = applySettings(
    current,
    makeBasePayload({
      channels: {
        ...makeBasePayload().channels,
        telegram: {
          ...makeBasePayload().channels.telegram,
          inlineButtons: "allowlist"
        }
      }
    })
  );

  assert.equal(next.channels.telegram.capabilities.inlineButtons, "allowlist");
  assert.equal(next.channels.telegram.capabilities.richMedia, true);
});

test("applySettings returns readable error for invalid telegram advanced json", () => {
  assert.throws(
    () =>
      applySettings(
        {
          models: {
            providers: {
              "aicodecat-gpt": {
                baseUrl: "https://aicode.cat/v1",
                api: "openai-responses",
                models: [{ id: "gpt-5.2", name: "GPT-5.2" }]
              }
            }
          },
          agents: {
            defaults: {
              model: {
                primary: "aicodecat-gpt/gpt-5.2"
              }
            }
          },
          channels: {}
        },
        makeBasePayload({
          channels: {
            ...makeBasePayload().channels,
            telegram: {
              ...makeBasePayload().channels.telegram,
              customCommandsJson: "{"
            }
          }
        })
      ),
    /Telegram 自定义命令（customCommandsJson） 不是有效 JSON/
  );
});
