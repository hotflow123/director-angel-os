export function resolveProfile(env = process.env) {
  if (env.NODE_ENV === "production") {
    return "production";
  }
  if (env.NODE_ENV === "test" || env.VITEST === "true") {
    return "test";
  }
  return "development";
}
//# sourceMappingURL=profile.js.map
