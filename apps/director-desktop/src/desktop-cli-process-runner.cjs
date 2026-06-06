const { resolve } = require("node:path");

const DIRECTOR_DESKTOP_APP_PATH = resolve(__dirname, "..");

function createRunCliProcessCommand({
  spawn,
  workspaceRoot,
  commandTimeoutMs,
  processEnv = process.env,
  emitDesktopEvent = () => {},
}) {
  return function runCliProcessCommand(request) {
    return new Promise((resolveCommand) => {
      const commandArgv = Array.isArray(request.argv) ? request.argv.slice(1) : [];
      const deniedLaunch = inspectDeniedDesktopProcessLaunch(request.executable, request.argv);
      if (deniedLaunch !== null) {
        resolveCommand({
          exitCode: 126,
          stdout: "",
          stderr: deniedLaunch.message,
          metadata: {
            signal: null,
            process: {
              signal: null,
              ownedProcess: false,
              terminationReason: "blocked",
              denied: deniedLaunch,
            },
          },
        });
        return;
      }
      const child = spawn(request.executable, [...request.argv], {
        cwd: request.cwd ?? workspaceRoot,
        env: {
          ...processEnv,
          ...(request.env ?? {}),
        },
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let terminationReason = "completed";
      const signalEvidence = [];
      const timer = setTimeout(() => {
        if (!settled) {
          terminationReason = "timeout";
          stderr = appendOutput(stderr, `\nCommand timed out after ${commandTimeoutMs}ms.`);
          sendProcessSignal(child, "SIGTERM", "timeout", signalEvidence);
        }
      }, commandTimeoutMs);
      timer.unref?.();

      child.stdout.on("data", (chunk) => {
        stdout = appendOutput(stdout, chunk);
        emitDesktopEvent(createCliStreamEvent(commandArgv, "stdout", chunk));
      });
      child.stderr.on("data", (chunk) => {
        stderr = appendOutput(stderr, chunk);
        emitDesktopEvent(createCliStreamEvent(commandArgv, "stderr", chunk));
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        terminationReason = "error";
        clearTimeout(timer);
        resolveCommand({
          exitCode: 1,
          stdout,
          stderr: appendOutput(stderr, error.message),
          metadata: {
            signal: null,
            process: createCliProcessEvidence(child, null, terminationReason, signalEvidence),
          },
        });
      });
      child.on("close", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const finalSignal = signal ?? signalEvidence.at(-1)?.signal ?? null;
        resolveCommand({
          exitCode: code ?? 1,
          stdout,
          stderr,
          metadata: {
            signal: finalSignal,
            process: createCliProcessEvidence(
              child,
              finalSignal,
              terminationReason,
              signalEvidence,
            ),
          },
        });
      });
    });
  };
}

function inspectDeniedDesktopProcessLaunch(executable, argv) {
  const commandLine = [executable, ...(Array.isArray(argv) ? argv : [])]
    .map((part) => String(part ?? ""))
    .join(" ");
  const normalized = commandLine.normalize("NFC");
  if (
    /moyin-creator(?:V[0-9.]+)?|\/Applications\/魔因漫创\.app|com\.manju2026\.moyin-creator/u.test(
      normalized,
    )
  ) {
    return {
      reason: "blocked-moyin-launch",
      message:
        "Director Angel blocked an attempt to launch Moyin from the desktop runtime. External apps require an explicit approved tool boundary.",
    };
  }
  if (/node_modules\/electron\/dist\/Electron\.app/u.test(normalized)) {
    const hasDirectorDesktopAppPath = (Array.isArray(argv) ? argv : []).some((part) =>
      isSameResolvedPath(part, DIRECTOR_DESKTOP_APP_PATH),
    );
    if (!hasDirectorDesktopAppPath) {
      return {
        reason: "blocked-bare-electron-launch",
        message:
          "Director Angel blocked a bare Electron launch without the director-desktop app path.",
      };
    }
  }
  if (
    /Google Chrome for Testing\.app|chrome-for-testing|angel-chrome|--remote-debugging-port=/iu.test(
      normalized,
    )
  ) {
    return {
      reason: "blocked-private-browser-launch",
      message:
        "Director Angel blocked a private browser launch from the desktop runtime. Use an already connected browser session instead of opening a new Chrome window.",
    };
  }
  return null;
}

function isSameResolvedPath(candidate, expectedPath) {
  const raw = String(candidate ?? "").trim();
  if (raw.length === 0) {
    return false;
  }
  try {
    return resolve(raw) === expectedPath;
  } catch {
    return false;
  }
}

function sendProcessSignal(child, signal, reason, signalEvidence) {
  signalEvidence.push({ signal, reason });
  try {
    child.kill(signal);
  } catch {
    // Best-effort timeout cleanup; the evidence still records the attempted signal.
  }
}

function createCliProcessEvidence(child, signal, terminationReason, signalEvidence) {
  return {
    ...(typeof child.pid === "number" ? { pid: child.pid } : {}),
    signal,
    ownedProcess: true,
    terminationReason,
    ...(signalEvidence.length === 0 ? {} : { signals: [...signalEvidence] }),
  };
}

function createCliStreamEvent(argv, stream, chunk) {
  return {
    type: `cli.${stream}`,
    role: stream === "stderr" ? "system" : "angel",
    title: stream === "stderr" ? "命令诊断" : "执行输出",
    body: String(chunk),
    actionType: "command.run",
    stream: true,
    argv,
    emittedAt: new Date().toISOString(),
  };
}

function appendOutput(current, chunk) {
  const next = `${current}${String(chunk)}`;
  const maxLength = 256 * 1024;
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
}

module.exports = {
  createRunCliProcessCommand,
};
