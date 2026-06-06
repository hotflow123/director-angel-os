import { describe, expect, it } from "vitest";

import { DirectorAdapterRegistry, createMockMediaAdapter } from "../src/adapters.ts";
import { resolveDirectorSwitchState } from "../src/switches.ts";

describe("director-runtime matcher", () => {
  it("honors required bindings", () => {
    const registry = new DirectorAdapterRegistry([
      createMockMediaAdapter({
        adapterId: "image-a",
        supportedModes: ["text_to_image"],
      }),
      createMockMediaAdapter({
        adapterId: "video-a",
      }),
    ]);

    const match = registry.matchMediaRoute({
      mode: "image",
      bindingPolicy: "require",
      requiredBinding: "image-a",
      switchState: resolveDirectorSwitchState(),
    });

    expect(match.status).toBe("matched");
    expect(match.selectedBindingId).toBe("image-a");
  });

  it("returns partial when it has to fall back from a preferred binding", () => {
    const registry = new DirectorAdapterRegistry([
      createMockMediaAdapter({
        adapterId: "video-b",
      }),
    ]);

    const match = registry.matchMediaRoute({
      mode: "video",
      bindingPolicy: "prefer",
      preferredBinding: "video-a",
      fallbackBindings: ["video-b"],
      switchState: resolveDirectorSwitchState(),
    });

    expect(match.status).toBe("partial");
    expect(match.selectedBindingId).toBe("video-b");
  });

  it("blocks when auto routing is disabled", () => {
    const registry = new DirectorAdapterRegistry([
      createMockMediaAdapter({
        adapterId: "video-a",
      }),
    ]);

    const match = registry.matchMediaRoute({
      mode: "video",
      bindingPolicy: "prefer",
      switchState: resolveDirectorSwitchState({
        features: {
          "autoRoute.enabled": false,
        },
      }),
    });

    expect(match.status).toBe("blocked");
    expect(match.reasons[0]).toContain("Automatic routing is disabled");
  });

  it("returns no_match when no adapter can satisfy the requested mode", () => {
    const registry = new DirectorAdapterRegistry([
      createMockMediaAdapter({
        adapterId: "image-a",
        supportedModes: ["text_to_image"],
      }),
    ]);

    const match = registry.matchMediaRoute({
      mode: "video",
      bindingPolicy: "prefer",
      switchState: resolveDirectorSwitchState(),
    });

    expect(["partial", "no_match"]).toContain(match.status);
    expect(match.reasons.length).toBeGreaterThan(0);
  });
});
