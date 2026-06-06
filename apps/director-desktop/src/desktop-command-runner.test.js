import { describe, expect, it, vi } from "vitest";

import { createDirectorDesktopCommandHandlers } from "./desktop-command-runner.js";
import { DESKTOP_ACTIONS } from "./desktop-contract.js";

describe("director desktop command runner", () => {
  it("lists the executable command catalog", async () => {
    const handlers = createDirectorDesktopCommandHandlers({
      runCliCommand: vi.fn(),
    });

    const result = await handlers.catalog();

    expect(result.catalog.some((group) => group.id === "workspace")).toBe(true);
    expect(result.events).toEqual([]);
  });

  it("dispatches desktopAction commands without exposing CLI details to the renderer", async () => {
    const handlers = createDirectorDesktopCommandHandlers({
      runCliCommand: vi.fn(),
    });
    const dispatchDesktopAction = vi.fn(async (action) => ({
      selectedDirectory: action.directory,
      events: [],
    }));

    const result = await handlers.run(
      {
        type: DESKTOP_ACTIONS.COMMAND_RUN,
        commandId: "learning.directory",
        args: { directory: "/tmp/learning-source", privacy: "internal", maxDepth: "2" },
      },
      dispatchDesktopAction,
    );

    expect(dispatchDesktopAction).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
      directory: "/tmp/learning-source",
      privacy: "internal",
      maxDepth: 2,
    });
    expect(result.commandResult).toMatchObject({
      status: "completed",
      handlerType: "desktopAction",
      actionType: DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
    });
  });

  it("runs CLI-backed commands through the injected main-process runner", async () => {
    const runCliCommand = vi.fn(async (argv) => ({
      argv,
      exitCode: 0,
      stdout: "Director workspace status\n",
      stderr: "",
    }));
    const handlers = createDirectorDesktopCommandHandlers({ runCliCommand });
    const dispatchDesktopAction = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/tmp/workspace" },
      events: [],
    }));

    const result = await handlers.run(
      {
        type: DESKTOP_ACTIONS.COMMAND_RUN,
        commandId: "workspace.status",
        args: {},
      },
      dispatchDesktopAction,
    );

    expect(runCliCommand).toHaveBeenCalledWith(["director", "status"]);
    expect(dispatchDesktopAction).toHaveBeenCalledWith({ type: DESKTOP_ACTIONS.SNAPSHOT });
    expect(result.commandResult).toMatchObject({
      status: "completed",
      handlerType: "cliCommand",
      exitCode: 0,
    });
    expect(result.events.at(-1)?.body).toContain("Director workspace status");
  });

  it("routes run CLI commands through Host API when a Host API runner is configured", async () => {
    const runCliCommand = vi.fn();
    const runHostApiCommand = vi.fn(async ({ command, args }) => ({
      commandResult: {
        status: "completed",
        handlerType: "hostApiRunCommand",
        command: { id: command.id },
        args,
      },
      events: [{ title: "Host API run command" }],
    }));
    const handlers = createDirectorDesktopCommandHandlers({
      runCliCommand,
      runHostApiCommand,
    });
    const dispatchDesktopAction = vi.fn();

    const result = await handlers.run(
      {
        type: DESKTOP_ACTIONS.COMMAND_RUN,
        commandId: "run.retry",
        args: { runId: "run-1", assignmentId: "assignment-1" },
      },
      dispatchDesktopAction,
    );

    expect(runCliCommand).not.toHaveBeenCalled();
    expect(runHostApiCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({ id: "run.retry" }),
        args: { runId: "run-1", assignmentId: "assignment-1" },
      }),
    );
    expect(result.commandResult).toMatchObject({
      handlerType: "hostApiRunCommand",
      command: { id: "run.retry" },
    });
  });

  it("routes V1 operator commands through Host API when a Host API runner is configured", async () => {
    const runCliCommand = vi.fn();
    const runHostApiCommand = vi.fn(async ({ command, args }) => ({
      commandResult: {
        status: "completed",
        handlerType: "hostApiRunCommand",
        command: { id: command.id },
        args,
      },
      events: [{ title: "Host API V1 command" }],
    }));
    const handlers = createDirectorDesktopCommandHandlers({
      runCliCommand,
      runHostApiCommand,
    });
    const dispatchDesktopAction = vi.fn();

      const v1Commands = [
        ["adapter.list", {}],
        ["binding.list", {}],
        ["binding.create", { bindingId: "desktop-main" }],
        ["binding.delete", { bindingId: "desktop-main" }],
      ["session.create", { peerId: "desktop-local" }],
      ["task.submit", { sessionId: "session-1", text: "生成短剧分镜" }],
      ["task.events", { taskId: "task-1" }],
        ["catalog.modelAdapters", {}],
        ["learning.jobsRun", { jobId: "learning-job-1" }],
        ["memory.publications", {}],
        ["memory.publicationDemote", { recordId: "memory-1" }],
        ["memory.publicationRetract", { recordId: "memory-1" }],
        ["memory.publicationQuarantine", { recordId: "memory-1" }],
        ["memory.publicationRestore", { recordId: "memory-1" }],
        ["evidence.list", { runId: "run-1" }],
        ["evidence.view", { evidenceId: "evidence-1" }],
        ["evidence.content", { evidenceId: "evidence-1" }],
        ["platform.capabilities", {}],
      ];

    const results = [];
    for (const [commandId, args] of v1Commands) {
      results.push(
        await handlers.run(
          {
            type: DESKTOP_ACTIONS.COMMAND_RUN,
            commandId,
            args,
          },
          dispatchDesktopAction,
        ),
      );
    }

    expect(runCliCommand).not.toHaveBeenCalled();
    expect(runHostApiCommand.mock.calls.map(([call]) => call.command.id)).toEqual(
      v1Commands.map(([commandId]) => commandId),
    );
    expect(runHostApiCommand.mock.calls.map(([call]) => call.args)).toEqual(
      v1Commands.map(([, args]) => args),
    );
    expect(results.map((result) => result.commandResult)).toEqual(
      v1Commands.map(([commandId, args]) =>
        expect.objectContaining({
          handlerType: "hostApiRunCommand",
          command: { id: commandId },
          args,
        }),
      ),
    );
  });

  it("falls back to CLI for V1 operator commands when no Host API runner is configured", async () => {
    const runCliCommand = vi.fn(async (argv) => ({
      argv,
      exitCode: 0,
      stdout: "Director V1 task\n",
      stderr: "",
    }));
    const handlers = createDirectorDesktopCommandHandlers({ runCliCommand });
    const dispatchDesktopAction = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/tmp/workspace" },
      events: [],
    }));

    const result = await handlers.run(
      {
        type: DESKTOP_ACTIONS.COMMAND_RUN,
        commandId: "task.submit",
        args: { sessionId: "session-1", text: "生成短剧分镜" },
      },
      dispatchDesktopAction,
    );

    expect(runCliCommand).toHaveBeenCalledWith([
      "director",
      "task",
      "submit",
      "--session-id",
      "session-1",
      "--text",
      "生成短剧分镜",
    ]);
    expect(result.commandResult).toMatchObject({
      handlerType: "cliCommand",
      command: {
        id: "task.submit",
      },
    });
  });
});
