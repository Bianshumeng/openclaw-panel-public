import { z } from "zod";

const modelDraftSchema = z.object({
  id: z.string().min(1, "model.id 不能为空"),
  name: z.string().optional().default(""),
  api: z.string().optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.string()).optional(),
  cost: z.record(z.number()).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional()
});

const settingsSchema = z.object({
  model: z.object({
    primary: z.string().min(1, "model.primary 不能为空"),
    providerId: z.string().min(1, "model.providerId 不能为空"),
    providerApi: z.string().min(1, "model.providerApi 不能为空"),
    providerBaseUrl: z.string().min(1, "model.providerBaseUrl 不能为空"),
    providerApiKey: z.string().optional().default(""),
    modelId: z.string().min(1, "model.modelId 不能为空"),
    modelName: z.string().min(1, "model.modelName 不能为空"),
    contextWindow: z.number().int().positive().default(200000),
    maxTokens: z.number().int().positive().default(8192),
    providerModels: z.array(modelDraftSchema).optional().default([])
  }),
  channels: z
    .object({
      telegram: z.object({
        enabled: z.boolean().default(false),
        botToken: z.string().optional().default(""),
        tokenFile: z.string().optional().default(""),
        dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).default("pairing"),
        allowFrom: z.string().optional().default(""),
        groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("allowlist"),
        groupAllowFrom: z.string().optional().default(""),
        requireMention: z.boolean().default(true),
        streamMode: z.enum(["off", "partial", "block"]).default("partial"),
        chunkMode: z.enum(["length", "newline"]).default("length"),
        textChunkLimit: z.number().int().positive().nullable().optional().default(null),
        replyToMode: z.enum(["off", "first", "all"]).default("off"),
        linkPreview: z.boolean().default(true),
        blockStreaming: z.boolean().default(false),
        timeoutSeconds: z.number().int().positive().nullable().optional().default(null),
        mediaMaxMb: z.number().int().positive().nullable().optional().default(null),
        dmHistoryLimit: z.number().int().nonnegative().nullable().optional().default(null),
        historyLimit: z.number().int().nonnegative().nullable().optional().default(null),
        webhookUrl: z.string().optional().default(""),
        webhookSecret: z.string().optional().default(""),
        webhookPath: z.string().optional().default("/telegram-webhook"),
        proxy: z.string().optional().default(""),
        configWrites: z.boolean().default(true),
        reactionLevel: z.enum(["off", "ack", "minimal", "extensive"]).default("minimal"),
        reactionNotifications: z.enum(["off", "own", "all"]).default("own"),
        inlineButtons: z.enum(["off", "dm", "group", "all", "allowlist"]).default("allowlist"),
        actionSendMessage: z.boolean().default(true),
        actionReactions: z.boolean().default(true),
        actionDeleteMessage: z.boolean().default(true),
        actionSticker: z.boolean().default(false),
        networkAutoSelectFamily: z.boolean().nullable().optional().default(null),
        retryAttempts: z.number().int().positive().nullable().optional().default(null),
        retryMinDelayMs: z.number().int().positive().nullable().optional().default(null),
        retryMaxDelayMs: z.number().int().positive().nullable().optional().default(null),
        retryJitter: z.boolean().default(true),
        commandsNative: z.enum(["default", "auto", "true", "false"]).default("default"),
        groupsJson: z.string().optional().default(""),
        accountsJson: z.string().optional().default(""),
        customCommandsJson: z.string().optional().default(""),
        draftChunkJson: z.string().optional().default("")
      }),
      feishu: z.object({
        enabled: z.boolean().default(false),
        appId: z.string().optional().default(""),
        appSecret: z.string().optional().default(""),
        domain: z.string().optional().default("feishu"),
        connectionMode: z.enum(["websocket", "webhook"]).default("websocket"),
        dmPolicy: z.enum(["open", "pairing", "allowlist"]).default("pairing"),
        allowFrom: z.string().optional().default(""),
        groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("allowlist"),
        groupAllowFrom: z.string().optional().default(""),
        requireMention: z.boolean().default(true)
      }),
      discord: z.object({
        enabled: z.boolean().default(false),
        token: z.string().optional().default(""),
        dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).default("pairing"),
        allowFrom: z.string().optional().default(""),
        groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("allowlist"),
        allowBots: z.boolean().default(false),
        requireMention: z.boolean().default(true)
      }),
      slack: z.object({
        enabled: z.boolean().default(false),
        mode: z.enum(["socket", "http"]).default("socket"),
        botToken: z.string().optional().default(""),
        appToken: z.string().optional().default(""),
        signingSecret: z.string().optional().default(""),
        dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).default("pairing"),
        allowFrom: z.string().optional().default(""),
        groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("allowlist"),
        allowBots: z.boolean().default(false),
        requireMention: z.boolean().default(true)
      })
    })
    .optional()
});

export { modelDraftSchema, settingsSchema };
export const openClawSettingsSchema = settingsSchema;
