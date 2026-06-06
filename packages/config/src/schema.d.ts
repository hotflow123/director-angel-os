import type { z } from "zod";
export declare const HotflowProfileSchema: z.ZodEnum<["development", "test", "production"]>;
export type HotflowProfile = z.infer<typeof HotflowProfileSchema>;
export declare const PermissionModeSchema: z.ZodEnum<["allow", "ask", "deny"]>;
export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export declare const OutputStyleSchema: z.ZodEnum<["concise", "normal", "verbose"]>;
export type OutputStyle = z.infer<typeof OutputStyleSchema>;
export declare const HotflowConfigSchema: z.ZodObject<
  {
    profile: z.ZodDefault<z.ZodEnum<["development", "test", "production"]>>;
    workspaceRoot: z.ZodString;
    dataDir: z.ZodString;
    sessionDbPath: z.ZodString;
    defaultProvider: z.ZodDefault<z.ZodString>;
    defaultModel: z.ZodDefault<z.ZodString>;
    permissionMode: z.ZodDefault<z.ZodEnum<["allow", "ask", "deny"]>>;
    outputStyle: z.ZodDefault<z.ZodEnum<["concise", "normal", "verbose"]>>;
  },
  "strip",
  z.ZodTypeAny,
  {
    profile: "development" | "test" | "production";
    workspaceRoot: string;
    dataDir: string;
    sessionDbPath: string;
    defaultProvider: string;
    defaultModel: string;
    permissionMode: "allow" | "ask" | "deny";
    outputStyle: "concise" | "normal" | "verbose";
  },
  {
    workspaceRoot: string;
    dataDir: string;
    sessionDbPath: string;
    profile?: "development" | "test" | "production" | undefined;
    defaultProvider?: string | undefined;
    defaultModel?: string | undefined;
    permissionMode?: "allow" | "ask" | "deny" | undefined;
    outputStyle?: "concise" | "normal" | "verbose" | undefined;
  }
>;
export type HotflowConfig = z.infer<typeof HotflowConfigSchema>;
//# sourceMappingURL=schema.d.ts.map
