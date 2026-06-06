const { readdirSync, rmSync, statSync } = require("node:fs");
const { join, resolve } = require("node:path");

process.env.COPYFILE_DISABLE ??= "1";

const repoRoot = resolve(__dirname, "../..");

function pruneAppleDoubleFiles(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.name.startsWith("._")) {
      rmSync(path, { force: true, recursive: true });
      continue;
    }
    if (entry.isDirectory()) {
      pruneAppleDoubleFiles(path);
      continue;
    }
    if (!entry.isSymbolicLink() && statSync(path).isDirectory()) {
      pruneAppleDoubleFiles(path);
    }
  }
}

module.exports = {
  appId: "com.hotflow.director-angel",
  productName: "Director Angel",
  copyright: "Copyright © 2026 Director Angel OS contributors",
  directories: {
    app: repoRoot,
    output: join(repoRoot, "release", "desktop"),
    buildResources: join(__dirname, "assets"),
  },
  files: [
    "package.json",
    "pnpm-workspace.yaml",
    "apps/director-desktop/package.json",
    "apps/director-desktop/src/**",
    "apps/director-desktop/assets/**",
    "apps/cli/package.json",
    "apps/cli/dist/**",
    "apps/director-host-api/package.json",
    "apps/director-host-api/dist/**",
    "apps/director-worker/package.json",
    "apps/director-worker/dist/**",
    "apps/worker-jobs/package.json",
    "apps/worker-jobs/dist/**",
    "apps/runtime-bootstrap/package.json",
    "apps/runtime-bootstrap/dist/**",
    "apps/weixin-gateway/package.json",
    "apps/weixin-gateway/dist/**",
    "packages/**/package.json",
    "packages/**/dist/**",
    "services/mempalace-adapter/package.json",
    "services/mempalace-adapter/dist/**",
    "internal-plugins/package.json",
    "internal-plugins/**/package.json",
    "internal-plugins/**/manifest.json",
    "internal-plugins/**/dist/**",
    "!**/*.map",
    "!**/*.tsbuildinfo",
    "!**/._*",
    "!**/.DS_Store",
    "!**/*.test.*",
    "!**/tests/**",
    "!benchmarks/**",
    "!docs/**",
    "!examples/**",
    "!release/**",
    "!backups/**",
    "!data/**",
    "!.hotflow/**",
    "!.director-angel/**",
  ],
  extraMetadata: {
    name: "director-angel",
    version: "0.0.1",
    main: "apps/director-desktop/src/electron-main.cjs",
  },
  npmRebuild: false,
  asar: false,
  mac: {
    category: "public.app-category.productivity",
    icon: join(__dirname, "assets", "DirectorAngel.icns"),
    target: ["zip"],
    hardenedRuntime: false,
    gatekeeperAssess: false,
  },
  afterPack: async (context) => {
    pruneAppleDoubleFiles(context.appOutDir);
  },
  afterSign: null,
};
