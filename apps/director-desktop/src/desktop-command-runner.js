import {
  buildDirectorDesktopAction,
  buildDirectorDesktopCliArgv,
  findDirectorDesktopCommand,
  listDirectorDesktopCommandCatalog,
} from "./desktop-command-catalog.js";
import { DESKTOP_ACTIONS, DESKTOP_EVENT_ROLES } from "./desktop-contract.js";

export function createDirectorDesktopCommandHandlers({ runCliCommand, runHostApiCommand } = {}) {
  return {
    catalog: async () => ({
      catalog: listDirectorDesktopCommandCatalog(),
      events: [],
    }),
    run: async (action, dispatchDesktopAction) => {
      if (!dispatchDesktopAction) {
        throw new Error("Director desktop command runner requires a desktop action dispatcher.");
      }
      const command = resolveCommand(action.commandId);
      const args = action.args ?? {};

      if (isHostApiCommand(command) && typeof runHostApiCommand === "function") {
        return runHostApiCommand({ command, args, dispatchDesktopAction });
      }

      if (command.handler.type === "desktopAction") {
        return runDesktopActionCommand({ command, args, dispatchDesktopAction });
      }

      if (!runCliCommand) {
        throw new Error(`Director desktop command ${command.id} requires a CLI runner.`);
      }

      return runCliBackedCommand({ command, args, runCliCommand, dispatchDesktopAction });
    },
  };
}

function resolveCommand(commandId) {
  if (typeof commandId !== "string" || commandId.trim().length === 0) {
    throw new Error("Director desktop command.run requires commandId.");
  }
  const command = findDirectorDesktopCommand(commandId);
  if (command === null) {
    throw new Error(`Unknown Director desktop command: ${commandId}`);
  }
  return command;
}

async function runDesktopActionCommand({ command, args, dispatchDesktopAction }) {
  const desktopAction = buildDirectorDesktopAction(command, args);
  const result = await dispatchDesktopAction(desktopAction);
  return {
    ...result,
    commandResult: {
      status: "completed",
      handlerType: command.handler.type,
      command: summarizeCommand(command),
      actionType: desktopAction.type,
    },
  };
}

async function runCliBackedCommand({ command, args, runCliCommand, dispatchDesktopAction }) {
  const argv = buildDirectorDesktopCliArgv(command, args);
  const commandResult = await runCliCommand(argv);
  const snapshotResult = await refreshSnapshot(dispatchDesktopAction);
  const event = createCliCommandEvent(command, commandResult);

  return {
    ...snapshotResult,
    commandResult: {
      ...commandResult,
      status: commandResult.exitCode === 0 ? "completed" : "failed",
      handlerType: command.handler.type,
      command: {
        ...summarizeCommand(command),
        argv,
      },
    },
    events: [...(snapshotResult.events ?? []), event],
  };
}

async function refreshSnapshot(dispatchDesktopAction) {
  try {
    return await dispatchDesktopAction({ type: DESKTOP_ACTIONS.SNAPSHOT });
  } catch (error) {
    return {
      events: [
        {
          role: DESKTOP_EVENT_ROLES.SYSTEM,
          title: "状态刷新失败",
          body: error instanceof Error ? error.message : String(error),
          actionType: DESKTOP_ACTIONS.SNAPSHOT,
        },
      ],
    };
  }
}

function createCliCommandEvent(command, commandResult) {
  const output = summarizeCommandOutput(commandResult);
  return {
    role: DESKTOP_EVENT_ROLES.SYSTEM,
    title: commandResult.exitCode === 0 ? command.label : `${command.label}失败`,
    body:
      output || (commandResult.exitCode === 0 ? "已完成。" : `退出码 ${commandResult.exitCode}。`),
    actionType: DESKTOP_ACTIONS.COMMAND_RUN,
  };
}

function summarizeCommandOutput(commandResult) {
  const text = (commandResult.stdout || commandResult.stderr || "").trim();
  if (text.length === 0) {
    return "";
  }
  const singleLine = text.replaceAll(/\s+/gu, " ");
  return singleLine.length > 240 ? `${singleLine.slice(0, 240)}...` : singleLine;
}

function summarizeCommand(command) {
  return {
    id: command.id,
    label: command.label,
    domain: command.domain,
  };
}

function isHostApiCommand(command) {
  return [
    "adapter.list",
    "memory.status",
    "memory.recallPreview",
    "memory.publications",
    "memory.publicationRetract",
    "memory.publicationDemote",
    "memory.publicationQuarantine",
    "memory.publicationRestore",
    "evidence.list",
    "evidence.view",
    "evidence.content",
    "maintenance.preview",
    "maintenance.apply",
    "run.status",
    "run.start",
    "run.pause",
    "run.resume",
    "run.abort",
    "run.report",
    "run.delegations",
    "run.schedulerExecutor",
    "run.schedulerRecovery",
    "run.retry",
    "run.reroute",
    "binding.list",
    "binding.create",
    "binding.delete",
    "session.create",
    "task.submit",
    "task.events",
    "catalog.modelAdapters",
    "learning.jobsRun",
    "platform.capabilities",
  ].includes(command.id);
}
