export async function startDesktopManagedHostApi({
  explicitHostApiUrl,
  createApp,
  env = process.env,
  experienceFetchText,
  externalToolControlPlane,
  externalToolExecutionQueue,
} = {}) {
  const configuredUrl = explicitHostApiUrl?.trim() || env.DIRECTOR_HOST_API_URL?.trim() || "";
  if (configuredUrl.length > 0) {
    return {
      managed: false,
      hostApiUrl: configuredUrl,
      close: async () => {},
    };
  }
  if (typeof createApp !== "function") {
    throw new Error("Desktop managed Host API requires createApp.");
  }

  const app = createApp({
    env,
    ...(experienceFetchText === undefined ? {} : { experienceFetchText }),
    ...(externalToolControlPlane === undefined ? {} : { externalToolControlPlane }),
    ...(externalToolExecutionQueue === undefined ? {} : { externalToolExecutionQueue }),
  });
  const host = env.DIRECTOR_HOST_API_HOST?.trim() || "127.0.0.1";
  const explicitPort = Number.parseInt(env.DIRECTOR_HOST_API_PORT ?? "", 10);
  const preferredPort = Number.isSafeInteger(explicitPort) && explicitPort > 0 ? explicitPort : 3201;
  const fallbackAllowed = !(Number.isSafeInteger(explicitPort) && explicitPort > 0);
  const listening = await startHostApiWithFallback(app, { host, preferredPort, fallbackAllowed });
  const hostApiUrl = `http://${listening.host}:${listening.port}`;

  env.DIRECTOR_HOST_API_URL = hostApiUrl;
  return {
    managed: true,
    hostApiUrl,
    close: async () => {
      await app.close();
    },
  };
}

async function startHostApiWithFallback(app, { host, preferredPort, fallbackAllowed }) {
  try {
    return await app.start({ host, port: preferredPort });
  } catch (error) {
    if (!fallbackAllowed || !isAddressInUseError(error)) {
      throw error;
    }
    return app.start({ host, port: 0 });
  }
}

function isAddressInUseError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error.code === "EADDRINUSE" || /EADDRINUSE|address already in use/iu.test(String(error)))
  );
}
