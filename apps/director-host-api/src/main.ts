import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ExternalToolRegistry,
  createExternalToolControlPlane,
  createOpenCliExternalToolRegistration,
} from "@hotflow/conversation-runtime";
import { type DirectorHostApiApp, createDirectorHostApiApp } from "./server.js";

let app: DirectorHostApiApp | undefined;
let closing = false;

async function start(): Promise<void> {
  app = createDirectorHostApiApp(createStandaloneHostApiRuntimeOptions());
  const host = process.env.DIRECTOR_HOST_API_HOST?.trim() || "127.0.0.1";
  const port = Number.parseInt(process.env.DIRECTOR_HOST_API_PORT ?? "", 10);
  const listenOptions = {
    host,
    ...(Number.isSafeInteger(port) && port > 0 ? { port } : {}),
  };
  const { host: listeningHost, port: listeningPort } = await app.start(listenOptions);
  console.log(`Director host API listening at http://${listeningHost}:${listeningPort}`);
}

async function shutdown(): Promise<void> {
  if (closing) {
    return;
  }
  closing = true;
  await app?.close();
  process.exit(0);
}

if (isMainEntrypoint()) {
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  void start().catch((error) => {
    console.error("Failed to start Director host API", error);
    void shutdown();
  });
}

function isMainEntrypoint(): boolean {
  return (
    process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

export function createStandaloneHostApiRuntimeOptions(env: NodeJS.ProcessEnv = process.env) {
  const workspaceRoot = resolveStandaloneWorkspaceRoot(
    env.HOTFLOW_WORKSPACE_ROOT ?? env.DIRECTOR_ANGEL_WORKSPACE_ROOT,
  );
  const externalToolRegistry = new ExternalToolRegistry();
  registerStandaloneOpenCliExternalTool(externalToolRegistry, workspaceRoot, env);
  return {
    env,
    externalToolControlPlane: createExternalToolControlPlane(externalToolRegistry),
  };
}

export function resolveStandaloneWorkspaceRoot(explicitRoot?: string): string {
  const explicit = explicitRoot?.trim();
  if (explicit) {
    return resolve(explicit);
  }

  return findStandaloneWorkspaceRoot(process.cwd());
}

function findStandaloneWorkspaceRoot(startDirectory: string): string {
  let current = resolve(startDirectory);

  while (true) {
    if (hasStandaloneWorkspaceMarkers(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return resolve(startDirectory);
    }
    current = parent;
  }
}

function hasStandaloneWorkspaceMarkers(directory: string): boolean {
  return (
    existsSync(join(directory, "pnpm-workspace.yaml")) ||
    existsSync(join(directory, "turbo.json")) ||
    existsSync(join(directory, "参考仓库", "OpenCLI", "cli-manifest.json"))
  );
}

function registerStandaloneOpenCliExternalTool(
  registry: ExternalToolRegistry,
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
): void {
  const explicitManifestPath = env.OPENCLI_MANIFEST_PATH?.trim();
  const workspaceManifestPath = join(workspaceRoot, "参考仓库", "OpenCLI", "cli-manifest.json");
  const manifestPath =
    explicitManifestPath && existsSync(explicitManifestPath)
      ? explicitManifestPath
      : existsSync(workspaceManifestPath)
        ? workspaceManifestPath
        : undefined;
  const openCliBinary = env.OPENCLI_BINARY?.trim();
  const exposeLimit = Number.parseInt(env.OPENCLI_COMMAND_EXPOSE_LIMIT ?? "2000", 10);
  registry.register(
    createOpenCliExternalToolRegistration({
      ...(openCliBinary ? { openCliBinary } : {}),
      ...(manifestPath === undefined ? {} : { manifestPath }),
      ...(Number.isSafeInteger(exposeLimit) && exposeLimit > 0
        ? { maxCommandCapabilities: exposeLimit }
        : {}),
      metadata: {
        hostApiSurface: "/v1/tools/*",
        channelPolicy: "host-api-shared-desktop-weixin-api",
        standaloneHostApi: true,
      },
    }),
  );
}
