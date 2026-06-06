import { setDirectorWorkerModuleLoaderForTests, startCli } from "../src/shell.ts";

const builtWorkerModuleUrl = new URL("../../director-worker/dist/main.js", import.meta.url);

setDirectorWorkerModuleLoaderForTests(async () => await import(builtWorkerModuleUrl.href));

const exitCode = await startCli(process.argv.slice(2));

if (typeof exitCode === "number") {
  process.exitCode = exitCode;
}
