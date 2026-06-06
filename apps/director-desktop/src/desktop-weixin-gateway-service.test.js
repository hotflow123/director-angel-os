import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  WEIXIN_GATEWAY_PARAMETER_ID,
  controlWeixinGatewayService,
  inspectWeixinGatewayService,
  pollWeixinGatewayLogin,
  selectWeixinGatewayAccount,
  setWeixinGatewayServiceEnabled,
  startWeixinGatewayLogin,
} from "./desktop-weixin-gateway-service.js";

const tempRoots = [];

describe("desktop weixin gateway service", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("inspects login, service config, logs, and launchd status without leaking credentials", async () => {
    const { workspaceRoot, home } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);
    writeFileSync(
      join(workspaceRoot, ".director-angel", "runtime", "logs", "weixin-gateway.out.log"),
      "weixin gateway started\nhandled message\n",
      "utf8",
    );
    const result = await inspectWeixinGatewayService(workspaceRoot, {
      env: { HOME: home, DIRECTOR_HOST_API_URL: "http://127.0.0.1:3201" },
      platform: "darwin",
      runCommand: async (file, args) => {
        if (file === "launchctl" && args[0] === "print") {
          return { code: 0, stdout: "state = running\npid = 1234\n", stderr: "" };
        }
        return { code: 1, stdout: "", stderr: "" };
      },
    });

    expect(result).toMatchObject({
      parameterId: WEIXIN_GATEWAY_PARAMETER_ID,
      running: true,
      status: "running",
      manager: "launchd",
      hostApiUrl: "http://127.0.0.1:3201",
      account: {
        loggedIn: true,
        primaryId: "test-account",
        primaryUserId: "user@im.wechat",
      },
      launchd: {
        pid: 1234,
      },
    });
    expect(result.channelContract).toMatchObject({
      ready: true,
      riskLevel: "low",
      requiredMissing: [],
      adapterId: "weixin-gateway",
      channel: "personal-weixin",
    });
    expect(result.logs.combined.join("\n")).toContain("handled message");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("shows pending Weixin runtime tool approvals in the gateway status snapshot", async () => {
    const { workspaceRoot, home } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);
    const approvalDir = join(
      workspaceRoot,
      ".director-angel",
      "weixin",
      "runtime-tool-approvals",
      "test-account",
    );
    mkdirSync(approvalDir, { recursive: true });
    writeFileSync(
      join(approvalDir, "approvals.json"),
      JSON.stringify({
        schemaVersion: "director.weixin.runtime-tool-approvals.v1",
        updatedAt: new Date().toISOString(),
        approvals: [
          {
            schemaVersion: "director.weixin.runtime-tool-approval.v1",
            approvalId: "tool:call-1",
            status: "pending",
            peerId: "friend@im.wechat",
            requestedByPeerId: "stranger@im.wechat",
            title: "确认使用 director.skills.set_enabled",
            summary: "启用浏览 Skill。",
            toolName: "director.skills.set_enabled",
            toolCall: {
              id: "call-1",
              name: "director.skills.set_enabled",
              args: { skillId: "skill.web-browser", enabled: true },
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
      "utf8",
    );

    const result = await inspectWeixinGatewayService(workspaceRoot, {
      env: { HOME: home, DIRECTOR_HOST_API_URL: "http://127.0.0.1:3201" },
      platform: "darwin",
      runCommand: async () => ({ code: 1, stdout: "", stderr: "not loaded" }),
    });

    expect(result.runtimeToolApprovals).toMatchObject({
      count: 1,
      pendingCount: 1,
      latest: {
        approvalId: "tool:call-1",
        status: "pending",
        toolName: "director.skills.set_enabled",
        requestedByPeerId: "stranger@im.wechat",
      },
    });
    expect(JSON.stringify(result.runtimeToolApprovals)).not.toContain("skill.web-browser");
  });

  it("expires stale Weixin runtime tool approvals before showing gateway status", async () => {
    const { workspaceRoot, home } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);
    const approvalDir = join(
      workspaceRoot,
      ".director-angel",
      "weixin",
      "runtime-tool-approvals",
      "test-account",
    );
    mkdirSync(approvalDir, { recursive: true });
    writeFileSync(
      join(approvalDir, "approvals.json"),
      JSON.stringify({
        schemaVersion: "director.weixin.runtime-tool-approvals.v1",
        updatedAt: "2000-01-01T00:00:00.000Z",
        approvals: [
          {
            schemaVersion: "director.weixin.runtime-tool-approval.v1",
            approvalId: "tool:stale",
            status: "pending",
            peerId: "friend@im.wechat",
            requestedByPeerId: "stranger@im.wechat",
            title: "确认使用 director.skills.set_enabled",
            summary: "启用浏览 Skill。",
            toolName: "director.skills.set_enabled",
            toolCall: {
              id: "call-1",
              name: "director.skills.set_enabled",
              args: { skillId: "skill.web-browser", enabled: true },
            },
            createdAt: "2000-01-01T00:00:00.000Z",
            updatedAt: "2000-01-01T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );

    const result = await inspectWeixinGatewayService(workspaceRoot, {
      env: { HOME: home, DIRECTOR_HOST_API_URL: "http://127.0.0.1:3201" },
      platform: "darwin",
      runCommand: async () => ({ code: 1, stdout: "", stderr: "not loaded" }),
    });

    expect(result.runtimeToolApprovals).toMatchObject({
      count: 1,
      pendingCount: 0,
      latest: {
        approvalId: "tool:stale",
        status: "expired",
        toolName: "director.skills.set_enabled",
      },
    });
  });

  it("enables the LaunchAgent and writes a persistent service config", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);
    const result = await setWeixinGatewayServiceEnabled(workspaceRoot, true, {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      platform: "darwin",
      gatewayMainPath: join(workspaceRoot, "apps", "weixin-gateway", "dist", "main.js"),
      fetch: async () => jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" }),
      runCommand: async (file, args, commandOptions = {}) => {
        const call = [file, ...args];
        call.env = commandOptions.env;
        calls.push(call);
        if (file === "launchctl" && args[0] === "print") {
          return { code: 1, stdout: "", stderr: "not loaded" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const plistPath = join(
      home,
      "Library",
      "LaunchAgents",
      "com.directorangel.weixin-gateway.plist",
    );
    const configPath = join(
      workspaceRoot,
      ".director-angel",
      "runtime",
      "gateway-service",
      "weixin-gateway.json",
    );

    expect(result.operation).toBe("start");
    expect(existsSync(plistPath)).toBe(true);
    expect(readFileSync(plistPath, "utf8")).toContain("com.directorangel.weixin-gateway");
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toMatchObject({
      schemaVersion: "director.weixin-gateway.service.v1",
      enabled: true,
      manager: "launchd",
    });
    expect(calls.map((call) => call.slice(0, 2))).toEqual(
      expect.arrayContaining([
        ["launchctl", "enable"],
        ["launchctl", "bootstrap"],
        ["launchctl", "kickstart"],
      ]),
    );
  });

  it("reloads an already loaded LaunchAgent so rewritten account env takes effect", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    await writeMultipleLoggedInAccounts(workspaceRoot, { selectedAccountId: "old-account" });

    const result = await controlWeixinGatewayService(workspaceRoot, "restart", {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      platform: "darwin",
      fetch: async () => jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" }),
      runCommand: async (file, args, commandOptions = {}) => {
        const call = [file, ...args];
        call.env = commandOptions.env;
        calls.push(call);
        if (file === "launchctl" && args[0] === "print") {
          return {
            code: 0,
            stdout: [
              "state = spawn scheduled",
              "environment = {",
              "  DIRECTOR_WEIXIN_ACCOUNT_ID => stale-account",
              "}",
            ].join("\n"),
            stderr: "",
          };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    const launchctlCalls = calls.filter((call) => call[0] === "launchctl");
    const bootoutIndex = launchctlCalls.findIndex((call) => call[1] === "bootout");
    const bootstrapIndex = launchctlCalls.findIndex((call) => call[1] === "bootstrap");
    const kickstartIndex = launchctlCalls.findIndex((call) => call[1] === "kickstart");
    const plist = readFileSync(
      join(home, "Library", "LaunchAgents", "com.directorangel.weixin-gateway.plist"),
      "utf8",
    );

    expect(bootoutIndex).toBeGreaterThanOrEqual(0);
    expect(bootstrapIndex).toBeGreaterThan(bootoutIndex);
    expect(kickstartIndex).toBeGreaterThan(bootstrapIndex);
    expect(plist).toContain("<key>DIRECTOR_WEIXIN_ACCOUNT_ID</key>");
    expect(plist).toContain("<string>old-account</string>");
  });

  it("passes trusted operator users to launchd and screen gateway starts", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);

    await controlWeixinGatewayService(workspaceRoot, "start", {
      env: {
        HOME: home,
        PATH: "/usr/bin:/bin",
        DIRECTOR_WEIXIN_TRUSTED_OPERATORS: "owner@im.wechat",
      },
      platform: "darwin",
      fetch: async () => jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" }),
      runCommand: async (file, args, commandOptions = {}) => {
        const call = [file, ...args];
        call.env = commandOptions.env;
        calls.push(call);
        if (file === "launchctl" && args[0] === "print") {
          return { code: 1, stdout: "", stderr: "not loaded" };
        }
        if (file === "screen" && args[0] === "-ls") {
          const started = calls.some((call) => call[0] === "screen" && call[1] === "-dmS");
          return started
            ? { code: 0, stdout: `1234.${"director-weixin"}\n`, stderr: "" }
            : { code: 1, stdout: "No Sockets found", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    const plist = readFileSync(
      join(home, "Library", "LaunchAgents", "com.directorangel.weixin-gateway.plist"),
      "utf8",
    );
    const screenStart = calls.find((call) => call[0] === "screen" && call[1] === "-dmS");

    expect(plist).toContain("<key>DIRECTOR_WEIXIN_TRUSTED_OPERATORS</key>");
    expect(plist).toContain("<string>owner@im.wechat</string>");
    expect(screenStart?.env?.DIRECTOR_WEIXIN_TRUSTED_OPERATORS).toBe("owner@im.wechat");
  });

  it("passes the desktop browser learning extractor URL to launchd, screen, and status", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);
    const learningFetchUrl = "http://127.0.0.1:38101/extract";

    const result = await controlWeixinGatewayService(workspaceRoot, "start", {
      env: {
        HOME: home,
        PATH: "/usr/bin:/bin",
        DIRECTOR_LEARNING_FETCH_URL: learningFetchUrl,
      },
      platform: "darwin",
      fetch: async () => jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" }),
      runCommand: async (file, args, commandOptions = {}) => {
        const call = [file, ...args];
        call.env = commandOptions.env;
        calls.push(call);
        if (file === "launchctl" && args[0] === "print") {
          return { code: 1, stdout: "", stderr: "not loaded" };
        }
        if (file === "screen" && args[0] === "-ls") {
          const started = calls.some((call) => call[0] === "screen" && call[1] === "-dmS");
          return started
            ? { code: 0, stdout: `1234.${"director-weixin"}\n`, stderr: "" }
            : { code: 1, stdout: "No Sockets found", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    const plist = readFileSync(
      join(home, "Library", "LaunchAgents", "com.directorangel.weixin-gateway.plist"),
      "utf8",
    );
    const config = JSON.parse(
      readFileSync(
        join(workspaceRoot, ".director-angel", "runtime", "gateway-service", "weixin-gateway.json"),
        "utf8",
      ),
    );
    const screenStart = calls.find((call) => call[0] === "screen" && call[1] === "-dmS");

    expect(result.service.learningFetchUrl).toBe(learningFetchUrl);
    expect(config.learningFetchUrl).toBe(learningFetchUrl);
    expect(plist).toContain("<key>DIRECTOR_LEARNING_FETCH_URL</key>");
    expect(plist).toContain(`<string>${learningFetchUrl}</string>`);
    expect(screenStart?.env?.DIRECTOR_LEARNING_FETCH_URL).toBe(learningFetchUrl);
  });

  it("preserves existing browser tool URL when writing service config without env", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);
    await writeGatewayServiceConfig(workspaceRoot, {
      enabled: true,
      browserToolUrl: "http://127.0.0.1:49876/tool",
    });

    const result = await controlWeixinGatewayService(workspaceRoot, "start", {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      platform: "darwin",
      fetch: async () => jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" }),
      runCommand: async (file, args, commandOptions = {}) => {
        const call = [file, ...args];
        call.env = commandOptions.env;
        calls.push(call);
        if (file === "launchctl" && args[0] === "print") {
          return { code: 1, stdout: "", stderr: "not loaded" };
        }
        if (file === "screen" && args[0] === "-ls") {
          const started = calls.some((call) => call[0] === "screen" && call[1] === "-dmS");
          return started
            ? { code: 0, stdout: `1234.${"director-weixin"}\n`, stderr: "" }
            : { code: 1, stdout: "No Sockets found", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    const config = JSON.parse(
      readFileSync(
        join(workspaceRoot, ".director-angel", "runtime", "gateway-service", "weixin-gateway.json"),
        "utf8",
      ),
    );
    const screenStart = calls.find((call) => call[0] === "screen" && call[1] === "-dmS");

    expect(result.service.browserToolUrl).toBe("http://127.0.0.1:49876/tool");
    expect(config.browserToolUrl).toBe("http://127.0.0.1:49876/tool");
    expect(screenStart?.env?.DIRECTOR_BROWSER_TOOL_URL).toBe("http://127.0.0.1:49876/tool");
  });

  it("falls back to screen when launchd reloads the plist but does not keep the gateway running", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);

    const result = await controlWeixinGatewayService(workspaceRoot, "start", {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      platform: "darwin",
      fetch: async () => jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" }),
      runCommand: async (file, args) => {
        calls.push([file, ...args]);
        if (file === "launchctl" && args[0] === "print") {
          return { code: 1, stdout: "", stderr: "not loaded" };
        }
        if (file === "screen" && args[0] === "-ls") {
          const started = calls.some((call) => call[0] === "screen" && call[1] === "-dmS");
          return started
            ? { code: 0, stdout: `1234.${"director-weixin"}\n`, stderr: "" }
            : { code: 1, stdout: "No Sockets found", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    expect(result).toMatchObject({
      operation: "start",
      method: "screen-fallback",
      ok: true,
      service: {
        running: true,
        manager: "screen",
      },
    });
    expect(calls.map((call) => call.slice(0, 3))).toEqual(
      expect.arrayContaining([
        ["launchctl", "bootout", "gui/501"],
        ["screen", "-dmS", "director-weixin"],
      ]),
    );
    const screenStart = calls.find((call) => call[0] === "screen" && call[1] === "-dmS");
    expect(screenStart?.slice(3, 5)).toEqual(["zsh", "-lc"]);
    expect(screenStart?.[5]).toContain("weixin-gateway.out.log");
    expect(screenStart?.[5]).toContain("weixin-gateway.err.log");
  });

  it("passes the shared desktop browser tool endpoint to launchd and screen starts", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);

    await controlWeixinGatewayService(workspaceRoot, "start", {
      env: {
        HOME: home,
        PATH: "/usr/bin:/bin",
        DIRECTOR_BROWSER_TOOL_URL: "http://127.0.0.1:49876/tool",
      },
      platform: "darwin",
      fetch: async () => jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" }),
      runCommand: async (file, args, commandOptions = {}) => {
        const call = [file, ...args];
        call.env = commandOptions.env;
        calls.push(call);
        if (file === "launchctl" && args[0] === "print") {
          return { code: 1, stdout: "", stderr: "not loaded" };
        }
        if (file === "screen" && args[0] === "-ls") {
          const started = calls.some((call) => call[0] === "screen" && call[1] === "-dmS");
          return started
            ? { code: 0, stdout: `1234.${"director-weixin"}\n`, stderr: "" }
            : { code: 1, stdout: "No Sockets found", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    const plist = readFileSync(
      join(home, "Library", "LaunchAgents", "com.directorangel.weixin-gateway.plist"),
      "utf8",
    );
    const screenStart = calls.find((call) => call[0] === "screen" && call[1] === "-dmS");

    expect(plist).toContain("<key>DIRECTOR_BROWSER_TOOL_URL</key>");
    expect(plist).toContain("<string>http://127.0.0.1:49876/tool</string>");
    expect(plist).toContain("<key>DIRECTOR_WEIXIN_HOST_TOOLS</key>");
    expect(plist).toContain("<string>true</string>");
    expect(screenStart?.env).toMatchObject({
      DIRECTOR_BROWSER_TOOL_URL: "http://127.0.0.1:49876/tool",
      DIRECTOR_WEIXIN_HOST_TOOLS: "true",
    });
  });

  it("stops stale workspace gateway processes before starting the managed service", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);
    let psCount = 0;

    await controlWeixinGatewayService(workspaceRoot, "start", {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      platform: "darwin",
      fetch: async () => jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" }),
      runCommand: async (file, args) => {
        calls.push([file, ...args]);
        if (file === "ps") {
          psCount += 1;
          return {
            code: 0,
            stdout:
              psCount === 1
                ? [
                    `111 node apps/weixin-gateway/dist/main.js start PWD=${workspaceRoot}`,
                    "222 node apps/weixin-gateway/dist/main.js start PWD=/tmp/other-workspace",
                    `${process.pid} node apps/weixin-gateway/dist/main.js start PWD=${workspaceRoot}`,
                  ].join("\n")
                : "",
            stderr: "",
          };
        }
        if (file === "launchctl" && args[0] === "print") {
          return { code: 0, stdout: "state = running\npid = 999\n", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls.filter((call) => call[0] === "kill").map((call) => call.slice(1))).toEqual([
      ["-TERM", "111"],
    ]);
    expect(calls.map((call) => call.slice(0, 3))).toEqual(
      expect.arrayContaining([
        ["launchctl", "disable", "gui/501/com.hotflow.director-angel.weixin-gateway"],
        ["launchctl", "stop", "com.hotflow.director-angel.weixin-gateway"],
      ]),
    );
  });

  it("force-cleans orphaned gateway processes that survive graceful stop", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);
    let psCount = 0;

    const result = await controlWeixinGatewayService(workspaceRoot, "restart", {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      platform: "darwin",
      fetch: async () => jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" }),
      processCleanupSettleMs: 0,
      runCommand: async (file, args) => {
        calls.push([file, ...args]);
        if (file === "ps") {
          psCount += 1;
          return {
            code: 0,
            stdout:
              psCount <= 2
                ? [
                    `111 /bin/zsh -lc cd '${workspaceRoot}' && exec node '${workspaceRoot}/apps/weixin-gateway/dist/main.js' 'start'`,
                    `222 node apps/weixin-gateway/dist/main.js start PWD=/tmp/other-workspace`,
                  ].join("\n")
                : "",
            stderr: "",
          };
        }
        if (file === "launchctl" && args[0] === "print") {
          return { code: 0, stdout: "state = running\npid = 999\n", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls.filter((call) => call[0] === "kill").map((call) => call.slice(1))).toEqual([
      ["-TERM", "111"],
      ["-KILL", "111"],
    ]);
    expect(calls.filter((call) => call[0] === "kill").map((call) => call.at(-1))).not.toContain(
      "222",
    );
    const killCommands = calls.filter((call) => call[0] === "kill");
    expect(killCommands).toHaveLength(2);
    expect(
      result.commands
        .filter((command) => command.tool === "kill")
        .map((command) => command.sandbox?.evidence?.backendConfig),
    ).toEqual([
      expect.objectContaining({
        commandPattern: {
          executable: "kill",
          argv: ["-TERM", "111"],
          operationId: "kill -TERM 111",
        },
      }),
      expect.objectContaining({
        commandPattern: {
          executable: "kill",
          argv: ["-KILL", "111"],
          operationId: "kill -KILL 111",
        },
      }),
    ]);
    expect(
      result.commands
        .filter((command) => command.tool === "kill")
        .map((command) => command.sandbox?.evidence?.process),
    ).toEqual([
      {
        pid: 111,
        signal: "SIGTERM",
        ownedProcess: true,
        terminationReason: "stale-workspace-gateway-cleanup",
        signals: [{ signal: "SIGTERM", reason: "stale-workspace-gateway-cleanup" }],
      },
      {
        pid: 111,
        signal: "SIGKILL",
        ownedProcess: true,
        terminationReason: "stale-workspace-gateway-cleanup",
        signals: [{ signal: "SIGKILL", reason: "stale-workspace-gateway-cleanup" }],
      },
    ]);
  });

  it("blocks startup with a clear reconnect message when the saved Weixin session is expired", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);

    const result = await controlWeixinGatewayService(workspaceRoot, "start", {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      platform: "darwin",
      fetch: async (url) => {
        if (String(url).includes("getupdates")) {
          return jsonResponse({ ret: -14, errcode: -14, errmsg: "expired" });
        }
        return jsonResponse({ ret: 0 });
      },
      runCommand: async (file, args) => {
        calls.push([file, ...args]);
        if (file === "launchctl" && args[0] === "print") {
          return { code: 1, stdout: "", stderr: "not loaded" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    expect(result).toMatchObject({
      operation: "start",
      method: "blocked",
      ok: false,
      issue: "expired-session",
      message: expect.stringContaining("重新连接微信"),
    });
    expect(calls.map((call) => call.slice(0, 2))).not.toEqual(
      expect.arrayContaining([
        ["launchctl", "enable"],
        ["launchctl", "bootstrap"],
        ["launchctl", "kickstart"],
      ]),
    );
  });

  it("uses the newest saved Weixin account for startup when older expired accounts remain", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    await writeMultipleLoggedInAccounts(workspaceRoot);
    const tokens = [];

    const result = await controlWeixinGatewayService(workspaceRoot, "start", {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      platform: "darwin",
      fetch: async (_url, init) => {
        const authorization = init?.headers?.Authorization ?? "";
        tokens.push(authorization);
        if (String(authorization).includes("old-token")) {
          return jsonResponse({ ret: -14, errcode: -14, errmsg: "expired" });
        }
        return jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" });
      },
      runCommand: async (file, args) => {
        calls.push([file, ...args]);
        if (file === "launchctl" && args[0] === "print") {
          return { code: 1, stdout: "", stderr: "not loaded" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    expect(result).toMatchObject({
      operation: "start",
      ok: expect.any(Boolean),
      service: {
        account: {
          primaryId: "new-account",
          primaryUserId: "new-user@im.wechat",
        },
      },
    });
    expect(result.issue).not.toBe("expired-session");
    expect(tokens.join("\n")).toContain("new-token");
    expect(tokens.join("\n")).not.toContain("old-token");
    expect(calls.map((call) => call.slice(0, 2))).toEqual(
      expect.arrayContaining([
        ["launchctl", "enable"],
        ["launchctl", "bootstrap"],
        ["launchctl", "kickstart"],
      ]),
    );
  });

  it("keeps an explicitly selected older account for readiness and LaunchAgent routing", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    await writeMultipleLoggedInAccounts(workspaceRoot, { selectedAccountId: "old-account" });
    const tokens = [];

    const result = await controlWeixinGatewayService(workspaceRoot, "start", {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      platform: "darwin",
      fetch: async (_url, init) => {
        tokens.push(init?.headers?.Authorization ?? "");
        return jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" });
      },
      runCommand: async (file, args) => {
        calls.push([file, ...args]);
        if (file === "launchctl" && args[0] === "print") {
          return { code: 1, stdout: "", stderr: "not loaded" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    const plist = readFileSync(
      join(home, "Library", "LaunchAgents", "com.directorangel.weixin-gateway.plist"),
      "utf8",
    );

    expect(result).toMatchObject({
      operation: "start",
      service: {
        account: {
          selectedAccountId: "old-account",
          primaryId: "old-account",
          primaryUserId: "old-user@im.wechat",
        },
      },
    });
    expect(tokens.join("\n")).toContain("old-token");
    expect(tokens.join("\n")).not.toContain("new-token");
    expect(plist).toContain("<key>DIRECTOR_WEIXIN_ACCOUNT_ID</key>");
    expect(plist).toContain("<string>old-account</string>");
  });

  it("switches to an older account and restarts an enabled gateway so the choice is immediate", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    await writeMultipleLoggedInAccounts(workspaceRoot, { selectedAccountId: "new-account" });
    await writeGatewayServiceConfig(workspaceRoot, { enabled: true, selectedAccountId: "new-account" });
    const tokens = [];

    const result = await selectWeixinGatewayAccount(workspaceRoot, "old-account", {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      platform: "darwin",
      fetch: async (_url, init) => {
        tokens.push(init?.headers?.Authorization ?? "");
        return jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" });
      },
      runCommand: async (file, args) => {
        calls.push([file, ...args]);
        if (file === "launchctl" && args[0] === "print") {
          return { code: 1, stdout: "", stderr: "not loaded" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    const selected = JSON.parse(
      readFileSync(
        join(workspaceRoot, ".director-angel", "weixin", "accounts", "selected-account.json"),
        "utf8",
      ),
    );
    const config = JSON.parse(
      readFileSync(
        join(workspaceRoot, ".director-angel", "runtime", "gateway-service", "weixin-gateway.json"),
        "utf8",
      ),
    );

    expect(result).toMatchObject({
      operation: "accountSelect",
      ok: expect.any(Boolean),
      account: {
        normalizedAccountId: "old-account",
        userId: "old-user@im.wechat",
      },
      service: {
        account: {
          selectedAccountId: "old-account",
          primaryId: "old-account",
        },
      },
      serviceOperation: {
        operation: "restart",
      },
    });
    expect(selected.accountId).toBe("old-account");
    expect(config.selectedAccountId).toBe("old-account");
    expect(tokens.join("\n")).toContain("old-token");
    expect(calls.map((call) => call.slice(0, 2))).toEqual(
      expect.arrayContaining([
        ["launchctl", "enable"],
        ["launchctl", "bootstrap"],
        ["launchctl", "kickstart"],
      ]),
    );
  });

  it("stops launchd and removes the plist when the switch is disabled", async () => {
    const { workspaceRoot, home, calls } = await createFixture();
    const plistPath = join(
      home,
      "Library",
      "LaunchAgents",
      "com.directorangel.weixin-gateway.plist",
    );
    await mkdir(join(home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(plistPath, "<plist />\n", "utf8");

    const result = await controlWeixinGatewayService(workspaceRoot, "stop", {
      env: { HOME: home },
      platform: "darwin",
      runCommand: async (file, args) => {
        calls.push([file, ...args]);
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    expect(result.operation).toBe("stop");
    expect(existsSync(plistPath)).toBe(false);
    expect(calls.map((call) => call.slice(0, 2))).toEqual(
      expect.arrayContaining([
        ["launchctl", "disable"],
        ["launchctl", "stop"],
        ["launchctl", "bootout"],
      ]),
    );
  });

  it("routes Weixin gateway lifecycle commands through the Agent OS sandbox runner", async () => {
    const { workspaceRoot, home } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);
    const sandboxCalls = [];
    const rawCalls = [];

    await controlWeixinGatewayService(workspaceRoot, "start", {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      platform: "darwin",
      fetch: async () => jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" }),
      runCommand: async (file, args) => {
        rawCalls.push([file, ...args]);
        return { code: 0, stdout: "raw", stderr: "" };
      },
      agentOsSandboxCommandRunner: async (request) => {
        sandboxCalls.push(request);
        if (request.executable === "launchctl" && request.argv[0] === "print") {
          return { exitCode: 1, stdout: "", stderr: "not loaded" };
        }
        if (request.executable === "screen" && request.argv[0] === "-ls") {
          const started = sandboxCalls.some(
            (call) => call.executable === "screen" && call.argv[0] === "-dmS",
          );
          return started
            ? { exitCode: 0, stdout: "1234.director-weixin\n", stderr: "" }
            : { exitCode: 1, stdout: "No Sockets found", stderr: "" };
        }
        return { exitCode: 0, stdout: "sandbox", stderr: "" };
      },
    });

    expect(rawCalls).toEqual([]);
    expect(sandboxCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backend: "host",
          executable: "launchctl",
          cwd: workspaceRoot,
        }),
        expect.objectContaining({
          backend: "host",
          executable: "screen",
          argv: expect.arrayContaining(["-dmS", "director-weixin"]),
          cwd: workspaceRoot,
        }),
      ]),
    );
  });

  it("does not admit Weixin gateway lifecycle commands through legacy command prefixes", async () => {
    const { workspaceRoot, home } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);

    const result = await controlWeixinGatewayService(workspaceRoot, "start", {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      platform: "darwin",
      fetch: async () => jsonResponse({ ret: 0, msgs: [], get_updates_buf: "" }),
      weixinGatewayAllowedCommandPrefixes: ["ps"],
      runCommand: async (file, args) => {
        if (file === "launchctl" && args[0] === "print") {
          return { code: 1, stdout: "", stderr: "not loaded" };
        }
        if (file === "ps") {
          return { code: 0, stdout: "", stderr: "" };
        }
        return { code: 0, stdout: "sandbox", stderr: "" };
      },
    });

    const backendConfigs = result.commands
      .filter((command) => command.tool === "ps")
      .map((command) => command.sandbox?.evidence?.backendConfig)
      .filter(Boolean);

    expect(backendConfigs.length).toBeGreaterThan(0);
    expect(backendConfigs).toEqual([
      expect.objectContaining({
        commandPattern: {
          executable: "ps",
          argv: ["eww", "-axo", "pid=,command="],
          operationId: "ps eww -axo pid=,command=",
        },
      }),
    ]);
    expect(backendConfigs.some((config) => "commandPrefix" in config)).toBe(false);
  });

  it("starts a desktop QR login session without exposing the raw QR session key", async () => {
    const { workspaceRoot, home } = await createFixture();
    const result = await startWeixinGatewayLogin(workspaceRoot, {
      env: { HOME: home },
      platform: "darwin",
      weixinLoginApi: {
        startWeixinQrLogin: async () => ({
          sessionKey: "session-1",
          qrcode: "qr-secret",
          qrcodeUrl: "data:image/png;base64,abc123",
        }),
      },
    });
    const pendingPath = join(
      workspaceRoot,
      ".director-angel",
      "runtime",
      "gateway-service",
      "weixin-login.json",
    );

    expect(result.login).toMatchObject({
      pending: true,
      sessionKey: "session-1",
      status: "qr",
      qrcodeImageSrc: "data:image/png;base64,abc123",
    });
    expect(readFileSync(pendingPath, "utf8")).toContain("qr-secret");
    expect(JSON.stringify(result)).not.toContain("qr-secret");
  });

  it("replaces an expired saved account with a fresh pending QR login session", async () => {
    const { workspaceRoot, home } = await createFixture();
    await writeLoggedInAccount(workspaceRoot);

    const result = await startWeixinGatewayLogin(workspaceRoot, {
      env: { HOME: home },
      platform: "darwin",
      weixinLoginApi: {
        startWeixinQrLogin: async () => ({
          sessionKey: "session-reconnect",
          qrcode: "new-qr-secret",
          qrcodeUrl: "data:image/png;base64,newqr",
        }),
      },
    });

    expect(result.login).toMatchObject({
      pending: true,
      sessionKey: "session-reconnect",
      status: "qr",
      qrcodeImageSrc: "data:image/png;base64,newqr",
    });
    expect(result.service.account.loggedIn).toBe(true);
    expect(result.service.login).toMatchObject({
      pending: true,
      status: "qr",
      qrcodeImageSrc: "data:image/png;base64,newqr",
    });
    expect(JSON.stringify(result)).not.toContain("new-qr-secret");
  });

  it("renders a scannable QR image when iLink only returns raw QR text", async () => {
    const { workspaceRoot, home } = await createFixture();
    const rawQrText = "weixin://login/director-angel/raw-ticket";

    const result = await startWeixinGatewayLogin(workspaceRoot, {
      env: { HOME: home },
      platform: "darwin",
      weixinLoginApi: {
        startWeixinQrLogin: async () => ({
          sessionKey: "session-raw-qr",
          qrcode: rawQrText,
          qrcodeUrl: rawQrText,
        }),
      },
    });

    expect(result.login).toMatchObject({
      pending: true,
      sessionKey: "session-raw-qr",
      status: "qr",
      qrcodeUrl: "",
    });
    expect(result.login.qrcodeImageSrc).toMatch(/^data:image\/png;base64,/u);
    expect(result.service.login.qrcodeImageSrc).toMatch(/^data:image\/png;base64,/u);
    expect(JSON.stringify(result)).not.toContain(rawQrText);
  });

  it("turns Weixin login URLs into local QR images instead of broken remote img srcs", async () => {
    const { workspaceRoot, home } = await createFixture();
    const loginUrl =
      "https://liteapp.weixin.qq.com/q/example?qrcode=raw-ticket&bot_type=desktop";

    const result = await startWeixinGatewayLogin(workspaceRoot, {
      env: { HOME: home },
      platform: "darwin",
      weixinLoginApi: {
        startWeixinQrLogin: async () => ({
          sessionKey: "session-login-url",
          qrcode: "raw-ticket",
          qrcodeUrl: loginUrl,
        }),
      },
    });

    expect(result.login).toMatchObject({
      pending: true,
      sessionKey: "session-login-url",
      status: "qr",
      qrcodeUrl: "",
    });
    expect(result.login.qrcodeImageSrc).toMatch(/^data:image\/png;base64,/u);
    expect(result.login.qrcodeImageSrc).not.toBe(loginUrl);
    expect(JSON.stringify(result)).not.toContain(loginUrl);
  });

  it("repairs an existing pending login file that stored a remote login URL as an img src", async () => {
    const { workspaceRoot, home } = await createFixture();
    const loginUrl =
      "https://liteapp.weixin.qq.com/q/example?qrcode=stale-ticket&bot_type=desktop";
    const pendingPath = join(
      workspaceRoot,
      ".director-angel",
      "runtime",
      "gateway-service",
      "weixin-login.json",
    );
    await mkdir(join(workspaceRoot, ".director-angel", "runtime", "gateway-service"), {
      recursive: true,
    });
    writeFileSync(
      pendingPath,
      `${JSON.stringify(
        {
          schemaVersion: "director.weixin-gateway.login.v1",
          sessionKey: "session-stale-url",
          qrcode: "stale-ticket",
          qrcodeUrl: loginUrl,
          qrcodeImageSrc: loginUrl,
          baseUrl: "https://api.example.test/",
          status: "wait",
          startedAt: "2026-05-01T10:00:00.000Z",
          updatedAt: "2026-05-01T10:00:00.000Z",
          expiresAt: "2999-05-01T10:08:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await inspectWeixinGatewayService(workspaceRoot, {
      env: { HOME: home },
      platform: "darwin",
      skipServiceControl: true,
    });
    const stored = JSON.parse(readFileSync(pendingPath, "utf8"));

    expect(result.login).toMatchObject({
      pending: true,
      sessionKey: "session-stale-url",
      status: "wait",
      qrcodeUrl: "",
    });
    expect(result.login.qrcodeImageSrc).toMatch(/^data:image\/png;base64,/u);
    expect(stored.qrcodeImageSrc).toMatch(/^data:image\/png;base64,/u);
    expect(JSON.stringify(result)).not.toContain(loginUrl);
  });

  it("polls QR login through verify-code and confirmed states, then starts the gateway", async () => {
    const { workspaceRoot, home } = await createFixture();
    const calls = [];
    const loginApi = {
      startWeixinQrLogin: async () => ({
        sessionKey: "session-2",
        qrcode: "qr-needs-code",
        qrcodeUrl: "https://example.test/qr.png",
      }),
      checkWeixinQrLoginStatus: async (input) => {
        calls.push(input);
        if (!input.verifyCode) {
          return { status: "need_verifycode", baseUrl: input.baseUrl, message: "需要验证码" };
        }
        return {
          status: "confirmed",
          baseUrl: input.baseUrl,
          credentials: {
            accountId: "account-with-code",
            token: "secret-login-token",
            baseUrl: input.baseUrl,
            userId: "user-with-code",
          },
        };
      },
      saveWeixinAccount: writeAccountFromCredentials,
    };

    await startWeixinGatewayLogin(workspaceRoot, {
      env: { HOME: home },
      platform: "darwin",
      weixinLoginApi: loginApi,
    });
    const needCode = await pollWeixinGatewayLogin(
      workspaceRoot,
      {},
      {
        env: { HOME: home },
        platform: "darwin",
        weixinLoginApi: loginApi,
      },
    );
    const confirmed = await pollWeixinGatewayLogin(
      workspaceRoot,
      { verifyCode: "489172" },
      {
        env: { HOME: home, PATH: "/usr/bin:/bin" },
        platform: "darwin",
        skipServiceControl: true,
        weixinLoginApi: loginApi,
      },
    );

    expect(needCode.login).toMatchObject({
      pending: true,
      status: "need_verifycode",
      needVerifyCode: true,
    });
    expect(calls.at(-1)).toMatchObject({ verifyCode: "489172" });
    expect(confirmed.login).toMatchObject({
      pending: false,
      status: "confirmed",
      account: {
        normalizedAccountId: "account-with-code",
        userId: "user-with-code",
      },
    });
    expect(confirmed.service.enabled).toBe(true);
    expect(confirmed.service.account.loggedIn).toBe(true);
    expect(JSON.stringify(confirmed)).not.toContain("secret-login-token");
  });
});

async function createFixture() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "director-weixin-service-"));
  const home = mkdtempSync(join(tmpdir(), "director-weixin-home-"));
  const calls = [];
  tempRoots.push(workspaceRoot, home);
  await mkdir(join(workspaceRoot, ".director-angel", "runtime", "logs"), { recursive: true });
  return { workspaceRoot, home, calls };
}

async function writeLoggedInAccount(workspaceRoot) {
  const accountDir = join(workspaceRoot, ".director-angel", "weixin", "accounts");
  await mkdir(accountDir, { recursive: true });
  writeFileSync(join(accountDir, "accounts.json"), `${JSON.stringify(["test-account"])}\n`, "utf8");
  writeFileSync(
    join(accountDir, "test-account.json"),
    `${JSON.stringify(
      {
        normalizedAccountId: "test-account",
        accountId: "test-account",
        baseUrl: "https://ilink.example.test/",
        userId: "user@im.wechat",
        token: "secret-token",
        savedAt: "2026-04-30T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function writeMultipleLoggedInAccounts(workspaceRoot, options = {}) {
  const accountDir = join(workspaceRoot, ".director-angel", "weixin", "accounts");
  await mkdir(accountDir, { recursive: true });
  writeFileSync(
    join(accountDir, "accounts.json"),
    `${JSON.stringify(["old-account", "new-account"])}\n`,
    "utf8",
  );
  writeFileSync(
    join(accountDir, "old-account.json"),
    `${JSON.stringify(
      {
        normalizedAccountId: "old-account",
        accountId: "old-account",
        baseUrl: "https://ilink.example.test/",
        userId: "old-user@im.wechat",
        token: "old-token",
        savedAt: "2026-04-29T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    join(accountDir, "new-account.json"),
    `${JSON.stringify(
      {
        normalizedAccountId: "new-account",
        accountId: "new-account",
        baseUrl: "https://ilink.example.test/",
        userId: "new-user@im.wechat",
        token: "new-token",
        savedAt: "2026-05-01T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  if (options.selectedAccountId) {
    writeFileSync(
      join(accountDir, "selected-account.json"),
      `${JSON.stringify(
        {
          accountId: options.selectedAccountId,
          selectedAt: "2026-05-01T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
}

function writeAccountFromCredentials(home, credentials) {
  const accountDir = join(home, "accounts");
  const normalizedAccountId = credentials.accountId;
  mkdirSync(accountDir, { recursive: true });
  writeFileSync(
    join(accountDir, "accounts.json"),
    `${JSON.stringify([normalizedAccountId])}\n`,
    "utf8",
  );
  const account = {
    normalizedAccountId,
    accountId: credentials.accountId,
    token: credentials.token,
    baseUrl: credentials.baseUrl,
    userId: credentials.userId,
    savedAt: "2026-04-30T00:00:00.000Z",
  };
  writeFileSync(
    join(accountDir, `${normalizedAccountId}.json`),
    `${JSON.stringify(account)}\n`,
    "utf8",
  );
  return account;
}

async function writeGatewayServiceConfig(workspaceRoot, options = {}) {
  const serviceDir = join(workspaceRoot, ".director-angel", "runtime", "gateway-service");
  await mkdir(serviceDir, { recursive: true });
  writeFileSync(
    join(serviceDir, "weixin-gateway.json"),
    `${JSON.stringify(
      {
        schemaVersion: "director.weixin-gateway.service.v1",
        enabled: options.enabled === true,
        manager: "launchd",
        serviceLabel: "com.directorangel.weixin-gateway",
        workspaceRoot,
        gatewayMainPath: join(workspaceRoot, "apps", "weixin-gateway", "dist", "main.js"),
        hostApiUrl: "http://127.0.0.1:3201",
        ...(options.learningFetchUrl ? { learningFetchUrl: options.learningFetchUrl } : {}),
        ...(options.browserToolUrl ? { browserToolUrl: options.browserToolUrl } : {}),
        ...(options.selectedAccountId ? { selectedAccountId: options.selectedAccountId } : {}),
        updatedAt: "2026-05-01T00:00:00.000Z",
        updatedBy: "test",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
