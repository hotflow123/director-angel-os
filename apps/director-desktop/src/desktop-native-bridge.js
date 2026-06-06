import { createDirectorDesktopBridgeFacade } from "./desktop-bridge-facade.js";
import {
  createDesktopOpenExternalUrlSandboxRunner,
  createDirectorDesktopSystemHandlers,
} from "./desktop-system-handlers.js";

export { createDesktopOpenExternalUrlSandboxRunner };

export function createDirectorDesktopNativeBridge(options) {
  const { desktop, emitDesktopEvent, ...systemOptions } = options;
  const systemHandlers = createDirectorDesktopSystemHandlers({
    ...systemOptions,
    emitDesktopEvent,
  });
  return createDirectorDesktopBridgeFacade({
    handlers: {
      ...systemHandlers,
      ...(desktop === undefined ? {} : { desktop }),
    },
    externalToolControlPlane: systemHandlers.externalToolControlPlane,
    externalToolExecutionQueue: systemHandlers.externalToolExecutionQueue,
    backgroundRuntime: systemHandlers.backgroundRuntime,
  });
}
