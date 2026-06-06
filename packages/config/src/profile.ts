import type { HotflowProfile } from "./schema.js";

export function resolveProfile(env: NodeJS.ProcessEnv = process.env): HotflowProfile {
  if (env.NODE_ENV === "production") {
    return "production";
  }

  if (env.NODE_ENV === "test" || env.VITEST === "true") {
    return "test";
  }

  return "development";
}
