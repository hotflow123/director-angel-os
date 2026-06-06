import { describe, expect, it, vi } from "vitest";

import { startDesktopManagedHostApi } from "./desktop-host-api-service.js";

describe("desktop managed Host API service", () => {
  it("uses an explicit Host API URL without starting a managed server", async () => {
    const createApp = vi.fn();
    const service = await startDesktopManagedHostApi({
      explicitHostApiUrl: "http://127.0.0.1:3999",
      createApp,
      env: {},
    });

    expect(service).toMatchObject({
      managed: false,
      hostApiUrl: "http://127.0.0.1:3999",
    });
    expect(createApp).not.toHaveBeenCalled();
  });

  it("starts a managed Host API with the desktop browser learning extractor injected", async () => {
    const env = {};
    const experienceFetchText = vi.fn();
    const app = {
      start: vi.fn(async () => ({ host: "127.0.0.1", port: 3201 })),
      close: vi.fn(async () => {}),
    };
    const createApp = vi.fn(() => app);

    const service = await startDesktopManagedHostApi({
      createApp,
      env,
      experienceFetchText,
    });

    expect(createApp).toHaveBeenCalledWith({
      env,
      experienceFetchText,
    });
    expect(app.start).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3201 });
    expect(service).toMatchObject({
      managed: true,
      hostApiUrl: "http://127.0.0.1:3201",
    });
    expect(env.DIRECTOR_HOST_API_URL).toBe("http://127.0.0.1:3201");

    await service.close();
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it("falls back to an ephemeral Host API port when the default port is already used", async () => {
    const env = {};
    const app = {
      start: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("address already in use"), { code: "EADDRINUSE" }))
        .mockResolvedValueOnce({ host: "127.0.0.1", port: 42117 }),
      close: vi.fn(async () => {}),
    };

    const service = await startDesktopManagedHostApi({
      createApp: () => app,
      env,
    });

    expect(app.start).toHaveBeenNthCalledWith(1, { host: "127.0.0.1", port: 3201 });
    expect(app.start).toHaveBeenNthCalledWith(2, { host: "127.0.0.1", port: 0 });
    expect(service.hostApiUrl).toBe("http://127.0.0.1:42117");
    expect(env.DIRECTOR_HOST_API_URL).toBe("http://127.0.0.1:42117");
  });
});
