import { createGatewayApp } from "./server.js";

function readGatewayHost(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.HOTFLOW_GATEWAY_HOST?.trim();
  return host && host.length > 0 ? host : "127.0.0.1";
}

function readGatewayPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.HOTFLOW_GATEWAY_PORT?.trim();
  if (!raw) {
    return 3100;
  }

  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid HOTFLOW_GATEWAY_PORT "${raw}".`);
  }
  return port;
}

const app = createGatewayApp();
const started = await app.start({
  host: readGatewayHost(),
  port: readGatewayPort(),
});

process.stdout.write(`Hotflow gateway listening on http://${started.host}:${started.port}\n`);

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
