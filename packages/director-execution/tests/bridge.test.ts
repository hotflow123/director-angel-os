import { describe, expect, test } from "vitest";

import {
  materializeHttpJsonBridgeFailure,
  materializeHttpJsonBridgeSuccess,
} from "../src/bridge.ts";

describe("execution bridge helpers", () => {
  test("materializes a redacted http-json bridge success snapshot", () => {
    const bridgeExecution = materializeHttpJsonBridgeSuccess({
      target: {
        kind: "http-json",
        adapterId: "seedance-preview",
        provider: "seedance",
        baseUrl: "https://bridge.example.test",
        submitPath: "/v1/jobs",
        timeoutMs: 15_000,
        authEnvVar: "SEEDANCE_API_KEY",
        headers: {
          authorization: "Bearer super-secret",
          "x-trace-id": "trace-1",
        },
      },
      payloadBytes: 512,
      response: {
        statusCode: 202,
        accepted: true,
        requestId: "req-1",
        bodyBytes: 96,
      },
    });

    expect(bridgeExecution).toEqual({
      kind: "http-json",
      request: {
        endpointOrigin: "https://bridge.example.test",
        endpointPath: "/v1/jobs",
        method: "POST",
        timeoutMs: 15_000,
        authMode: "env",
        headerKeys: ["authorization", "x-trace-id"],
        payloadBytes: 512,
      },
      response: {
        statusCode: 202,
        accepted: true,
        requestId: "req-1",
        bodyBytes: 96,
      },
    });
  });

  test("materializes a structured bridge failure without leaking header values", () => {
    const bridgeExecution = materializeHttpJsonBridgeFailure({
      target: {
        kind: "http-json",
        adapterId: "seedance-preview",
        provider: "seedance",
        baseUrl: "https://bridge.example.test",
        submitPath: "/v1/jobs",
        timeoutMs: 10_000,
        headers: {
          authorization: "Bearer should-not-leak",
          "x-api-key": "secret-2",
        },
      },
      payloadBytes: 1024,
      failure: {
        reason: "network_timeout",
        message: "Bridge request timed out.",
        retryable: true,
        statusCode: 504,
      },
    });

    expect(bridgeExecution.request.headerKeys).toEqual(["authorization", "x-api-key"]);
    expect(JSON.stringify(bridgeExecution)).not.toContain("should-not-leak");
    expect(JSON.stringify(bridgeExecution)).not.toContain("secret-2");
    expect(bridgeExecution.failure).toEqual({
      reason: "network_timeout",
      message: "Bridge request timed out.",
      retryable: true,
      statusCode: 504,
    });
  });
});
