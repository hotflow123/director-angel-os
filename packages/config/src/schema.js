import { z } from "zod";
export const HotflowProfileSchema = z.enum(["development", "test", "production"]);
export const PermissionModeSchema = z.enum(["allow", "ask", "deny"]);
export const OutputStyleSchema = z.enum(["concise", "normal", "verbose"]);
export const ResponseLanguageSchema = z.string().trim().min(1);
export const HotflowConfigSchema = z.object({
  profile: HotflowProfileSchema.default("development"),
  workspaceRoot: z.string().min(1),
  dataDir: z.string().min(1),
  sessionDbPath: z.string().min(1),
  defaultProvider: z.string().min(1).default("scripted"),
  defaultModel: z.string().min(1).default("hotflow-phase1"),
  permissionMode: PermissionModeSchema.default("ask"),
  outputStyle: OutputStyleSchema.default("normal"),
  responseLanguage: ResponseLanguageSchema.default("follow-user"),
});
//# sourceMappingURL=schema.js.map
