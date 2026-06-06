import { assessExtractedContentQuality } from "./builtin-web-tools.js";
import type {
  ConversationRuntimeToolExecutionInput,
  ConversationRuntimeToolExecutionOutput,
  ConversationRuntimeToolExecutorPort,
} from "./model-tool-loop.js";

export interface ConversationRuntimeUrlLearningReadInput {
  readonly url: string;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly executeTool: ConversationRuntimeToolExecutorPort;
  readonly userText?: string;
  readonly browserFallback?: boolean;
  readonly browserProfile?: "angel" | "user" | "electron" | (string & {});
  readonly skipWebExtract?: boolean;
  readonly maxBytes?: number;
  readonly maxSnapshotChars?: number;
}

export type ConversationRuntimeUrlLearningReadStatus = "trusted" | "blocked" | "error";

export interface ConversationRuntimeUrlLearningTrustedSource {
  readonly url: string;
  readonly title: string;
  readonly body: string;
  readonly contentType: string;
  readonly via: "web_extract" | "browser_snapshot" | "opencli";
  readonly quality: Readonly<Record<string, unknown>>;
  readonly sourceSnapshot?: Readonly<Record<string, unknown>>;
  readonly structuredContent?: Readonly<Record<string, unknown>>;
  readonly externalContent?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeUrlLearningReadAttempt {
  readonly toolName: string;
  readonly ok: boolean;
  readonly status: string;
  readonly url?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly mediaInventory?: Readonly<Record<string, unknown>>;
  readonly mediaAuthorization?: Readonly<Record<string, unknown>>;
  readonly mediaAdmission?: Readonly<Record<string, unknown>>;
  readonly mediaUnderstandingWorkflow?: Readonly<Record<string, unknown>>;
  readonly failures: readonly string[];
}

export interface ConversationRuntimeUrlLearningReadResult {
  readonly status: ConversationRuntimeUrlLearningReadStatus;
  readonly source?: ConversationRuntimeUrlLearningTrustedSource;
  readonly attempts: readonly ConversationRuntimeUrlLearningReadAttempt[];
  readonly failures: readonly string[];
  readonly nextActions: readonly string[];
  readonly candidateCount: 0;
}

const DEFAULT_MAX_BYTES = 120_000;
const DEFAULT_SNAPSHOT_MAX_CHARS = 16_000;

export async function orchestrateConversationRuntimeUrlLearningRead(
  input: ConversationRuntimeUrlLearningReadInput,
): Promise<ConversationRuntimeUrlLearningReadResult> {
  const attempts: ConversationRuntimeUrlLearningReadAttempt[] = [];
  const failures: string[] = [];
  const nextActions: string[] = [];
  if (isXThreadUrl(input.url)) {
    const openCliRead = await readXThreadViaOpenCli(input);
    attempts.push(...openCliRead.attempts);
    if (openCliRead.status === "trusted") {
      return openCliRead;
    }
    return createBlockedResult({
      attempts,
      failures: openCliRead.failures,
      nextActions: openCliRead.nextActions,
    });
  }
  if (input.skipWebExtract !== true) {
    const webExtract = await input.executeTool(
      createToolExecutionInput({
        input,
        id: "url-learning-web-extract",
        name: "web_extract",
        args: {
          url: input.url,
          mode: "auto",
          max_bytes: input.maxBytes ?? DEFAULT_MAX_BYTES,
        },
      }),
    );
    attempts.push(toAttempt(webExtract));

    const webTrusted = readTrustedSourceFromWebExtract(webExtract, input.url);
    if (webTrusted !== null) {
      return {
        status: "trusted",
        source: webTrusted,
        attempts,
        failures,
        nextActions: ["admit trusted extracted text into learning"],
        candidateCount: 0,
      };
    }
    failures.push(...readFailures(webExtract));
    nextActions.push(...readNextActions(webExtract));
  } else {
    nextActions.push("retry with browser_navigate/browser_snapshot using the latest URL");
  }

  if (input.browserFallback === false) {
    return createBlockedResult({
      attempts,
      failures,
      nextActions: [
        ...nextActions,
        "retry from a runtime with interactive browser automation when dynamic or protected pages are required",
      ],
    });
  }

  const profile = input.browserProfile ?? resolveBrowserProfile(input.userText);
  const navigate = await input.executeTool(
    createToolExecutionInput({
      input,
      id: "url-learning-browser-navigate",
      name: "browser_navigate",
      args: {
        url: input.url,
        profile,
      },
    }),
  );
  attempts.push(toAttempt(navigate));
  if (!navigate.ok) {
    failures.push(...readFailures(navigate));
    nextActions.push(...readNextActions(navigate));
    return createBlockedResult({ attempts, failures, nextActions });
  }

  const snapshot = await input.executeTool(
    createToolExecutionInput({
      input,
      id: "url-learning-browser-snapshot",
      name: "browser_snapshot",
      args: {
        full: true,
        mode: "readable",
        max_chars: input.maxSnapshotChars ?? DEFAULT_SNAPSHOT_MAX_CHARS,
        urls: true,
        compact: true,
        refs: true,
        reason:
          "URL learning needs trusted readable source text after web_extract was blocked or low quality.",
      },
    }),
  );
  attempts.push(toAttempt(snapshot));
  const browserTrusted = readTrustedSourceFromBrowserSnapshot(snapshot, input.url);
  if (browserTrusted !== null) {
    return {
      status: "trusted",
      source: browserTrusted,
      attempts,
      failures,
      nextActions: ["admit trusted browser snapshot text into learning"],
      candidateCount: 0,
    };
  }

  failures.push(...readFailures(snapshot));
  nextActions.push(...readNextActions(snapshot));
  return createBlockedResult({ attempts, failures, nextActions });
}

function createToolExecutionInput(input: {
  readonly input: ConversationRuntimeUrlLearningReadInput;
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}): ConversationRuntimeToolExecutionInput {
  return {
    turnId: input.input.turnId,
    sessionKey: input.input.sessionKey,
    call: {
      id: input.id,
      name: input.name,
      args: input.args,
    },
    metadata: {
      intent: "url-learning-read",
      ...(input.input.userText === undefined ? {} : { userText: input.input.userText }),
    },
  };
}

function readTrustedSourceFromWebExtract(
  result: ConversationRuntimeToolExecutionOutput,
  fallbackUrl: string,
): ConversationRuntimeUrlLearningTrustedSource | null {
  if (!result.ok || !isRecord(result.output)) {
    return null;
  }
  const quality = readRecord(result.output, "quality");
  if (!isPublishableQuality(quality)) {
    return null;
  }
  const body = readString(result.output, "body") ?? readString(result.output, "text_preview");
  if (body === undefined || body.trim().length === 0) {
    return null;
  }
  const url = readString(result.output, "url") ?? fallbackUrl;
  const title = readString(result.output, "title") ?? url;
  const textPreview = readString(result.output, "text_preview") ?? body.slice(0, 1200);
  const reassessed = assessExtractedContentQuality({
    url,
    title,
    body,
    textPreview,
  });
  if (reassessed.status !== "ok") {
    return null;
  }
  const sourceSnapshot = readRecord(result.output, "source_snapshot");
  const structuredContent = readRecord(result.output, "structured_content");
  const externalContent = readRecord(result.output, "external_content");
  return {
    url,
    title,
    body,
    contentType: readString(result.output, "content_type") ?? "text/plain",
    via: "web_extract",
    quality: quality ?? reassessed,
    ...(sourceSnapshot === undefined ? {} : { sourceSnapshot }),
    ...(structuredContent === undefined ? {} : { structuredContent }),
    ...(externalContent === undefined ? {} : { externalContent }),
  };
}

function readTrustedSourceFromBrowserSnapshot(
  result: ConversationRuntimeToolExecutionOutput,
  fallbackUrl: string,
): ConversationRuntimeUrlLearningTrustedSource | null {
  if (!result.ok || !isRecord(result.output)) {
    return null;
  }
  const body =
    readString(result.output, "text") ??
    readString(result.output, "snapshot") ??
    readString(result.output, "snapshot_preview");
  if (body === undefined || body.trim().length === 0) {
    return null;
  }
  const url = readString(result.output, "url") ?? fallbackUrl;
  const title = readString(result.output, "title") ?? url;
  const quality = assessExtractedContentQuality({
    url,
    title,
    body,
    textPreview: body.slice(0, 1200),
  });
  if (quality.status !== "ok") {
    return null;
  }
  return {
    url,
    title,
    body,
    contentType: "text/plain",
    via: "browser_snapshot",
    quality,
    sourceSnapshot: {
      id: `browser-snapshot-${safeSnapshotId(url)}`,
      source_kind: "url",
      source_ref: url,
      access_status: "available",
      readable_chars: body.length,
    },
    externalContent: {
      source_url: fallbackUrl,
      final_url: url,
      title,
      content_type: "text/plain",
      trust_boundary: "external-browser",
    },
  };
}

async function readXThreadViaOpenCli(
  input: ConversationRuntimeUrlLearningReadInput,
): Promise<ConversationRuntimeUrlLearningReadResult> {
  const article = await readXUrlViaOpenCliOperation(input, {
    operationId: "opencli.twitter.article",
    title: "OpenCLI Twitter/X article",
    missingIsNull: true,
  });
  if (article !== null && article.status === "trusted") {
    return article;
  }
  const thread = await readXUrlViaOpenCliOperation(input, {
    operationId: "opencli.twitter.thread",
    title: "OpenCLI Twitter/X thread",
    priorAttempts: article?.attempts ?? [],
    priorFailures: article?.failures ?? [],
    priorNextActions: article?.nextActions ?? [],
  });
  return (
    thread ??
    createBlockedResult({
      attempts: article?.attempts ?? [],
      failures: [...(article?.failures ?? []), "OpenCLI X/Twitter 只读读取工具不可用。"],
      nextActions: [
        ...(article?.nextActions ?? []),
        "确认 opencli.twitter.article 或 opencli.twitter.thread 已在 Host Tool Control Plane 注册",
      ],
    })
  );
}

async function readXUrlViaOpenCliOperation(
  input: ConversationRuntimeUrlLearningReadInput,
  options: {
    readonly operationId: "opencli.twitter.article" | "opencli.twitter.thread";
    readonly title: string;
    readonly missingIsNull?: boolean;
    readonly priorAttempts?: readonly ConversationRuntimeUrlLearningReadAttempt[];
    readonly priorFailures?: readonly string[];
    readonly priorNextActions?: readonly string[];
  },
): Promise<ConversationRuntimeUrlLearningReadResult | null> {
  const result = await input.executeTool(
    createToolExecutionInput({
      input,
      id: `url-learning-${options.operationId.replace(/\./gu, "-")}`,
      name: "director.opencli.invoke",
      args: {
        operationId: options.operationId,
        args: {
          "tweet-id": input.url,
        },
        reason: "X/Twitter URL learning uses the same read-only OpenCLI path as desktop.",
      },
    }),
  );
  const attempt = toAttempt(result);
  const attempts = [...(options.priorAttempts ?? []), attempt];
  if (!result.ok || !isRecord(result.output)) {
    if (options.missingIsNull === true && isOpenCliOperationMissing(result)) {
      return null;
    }
    return createBlockedResult({
      attempts,
      failures: dedupeStrings([
        ...(options.priorFailures ?? []),
        ...attempt.failures,
        result.error ?? `${options.title} 读取失败。`,
      ]),
      nextActions: dedupeStrings([
        ...(options.priorNextActions ?? []),
        "确认 OpenCLI Browser Bridge 已连接并登录 X 后重试",
      ]),
    });
  }
  const parsedOpenCli = parseOpenCliReadableSource(result.output, input.url);
  const body =
    parsedOpenCli?.body ?? readString(result.output, "body") ?? readString(result.output, "text");
  if (body === undefined || body.trim().length === 0) {
    return createBlockedResult({
      attempts,
      failures: dedupeStrings([
        ...(options.priorFailures ?? []),
        `${options.title} 没有返回可信正文。`,
      ]),
      nextActions: dedupeStrings([
        ...(options.priorNextActions ?? []),
        "读不到可信正文时，不创建经验候选",
      ]),
    });
  }
  const url = parsedOpenCli?.url ?? readString(result.output, "url") ?? input.url;
  const title = parsedOpenCli?.title ?? readString(result.output, "title") ?? options.title;
  const quality = assessExtractedContentQuality({
    url,
    title,
    body,
    textPreview: body.slice(0, 1200),
  });
  if (quality.status !== "ok") {
    return createBlockedResult({
      attempts,
      failures: dedupeStrings([
        ...(options.priorFailures ?? []),
        `${options.title} 没有返回可信正文。`,
      ]),
      nextActions: dedupeStrings([
        ...(options.priorNextActions ?? []),
        "读不到可信正文时，不创建经验候选",
      ]),
    });
  }
  return {
    status: "trusted",
    source: {
      url,
      title,
      body,
      contentType: "text/plain",
      via: "opencli",
      quality: { ...quality, source: options.operationId },
      structuredContent: {
        schemaVersion: "director.source.snapshot.v1",
        kind:
          options.operationId === "opencli.twitter.article"
            ? "opencli-twitter-article"
            : "opencli-twitter-thread",
        operationId: options.operationId,
        ...(parsedOpenCli === undefined ? {} : { parsedSource: parsedOpenCli.source }),
        output: result.output,
      },
      externalContent: {
        source_url: input.url,
        final_url: url,
        title,
        content_type: "text/plain",
        trust_boundary: "opencli-browser-bridge",
        operation_id: options.operationId,
      },
    },
    attempts,
    failures: dedupeStrings(options.priorFailures ?? []),
    nextActions: dedupeStrings([
      ...(options.priorNextActions ?? []),
      `admit trusted ${options.title} text into learning`,
    ]),
    candidateCount: 0,
  };
}

function createBlockedResult(input: {
  readonly attempts: readonly ConversationRuntimeUrlLearningReadAttempt[];
  readonly failures: readonly string[];
  readonly nextActions: readonly string[];
}): ConversationRuntimeUrlLearningReadResult {
  return {
    status: "blocked",
    attempts: input.attempts,
    failures: dedupeStrings([
      ...input.failures,
      "low-quality extracted content: page appears to be verification, login, or UI residue instead of article body",
    ]),
    nextActions: dedupeStrings([
      ...input.nextActions,
      "do not create learning candidates until trusted source text is available",
    ]),
    candidateCount: 0,
  };
}

function toAttempt(
  result: ConversationRuntimeToolExecutionOutput,
): ConversationRuntimeUrlLearningReadAttempt {
  const output = isRecord(result.output) ? result.output : {};
  const url = readString(output, "url");
  const title = readString(output, "title");
  const summary = readString(output, "summary");
  const mediaInventory =
    readRecord(output, "media_inventory") ?? readRecord(output, "mediaInventory");
  const mediaUnderstandingWorkflow =
    readRecord(output, "media_understanding_workflow") ??
    readRecord(output, "mediaUnderstandingWorkflow");
  const learningGate = readRecord(output, "learning_gate") ?? readRecord(output, "learningGate");
  const mediaAuthorization =
    readNestedRecord(mediaUnderstandingWorkflow, "authorization", "request") ??
    readRecord(learningGate, "mediaAuthorizationRequest") ??
    readRecord(output, "mediaAuthorizationRequest") ??
    readRecord(output, "media_authorization_request");
  const mediaAdmission =
    readRecord(mediaUnderstandingWorkflow, "admission") ??
    readRecord(output, "mediaAdmission") ??
    readRecord(output, "media_admission");
  return {
    toolName: result.toolName,
    ok: result.ok,
    status: readString(output, "status") ?? (result.ok ? "success" : "error"),
    ...(url === undefined ? {} : { url }),
    ...(title === undefined ? {} : { title }),
    ...(summary === undefined ? {} : { summary }),
    ...(mediaInventory === undefined ? {} : { mediaInventory }),
    ...(mediaAuthorization === undefined ? {} : { mediaAuthorization }),
    ...(mediaAdmission === undefined ? {} : { mediaAdmission }),
    ...(mediaUnderstandingWorkflow === undefined ? {} : { mediaUnderstandingWorkflow }),
    failures: readFailures(result),
  };
}

function isPublishableQuality(quality: Readonly<Record<string, unknown>> | undefined): boolean {
  if (quality === undefined) {
    return false;
  }
  return quality.status === "ok" && quality.publishable === true;
}

function resolveBrowserProfile(userText: string | undefined): "angel" | "user" {
  if (
    userText !== undefined &&
    /(我的|用户|真实).*(Chrome|谷歌浏览器|浏览器|登录态|账号|cookie)|用.*(Chrome|谷歌浏览器).*(登录态|账号|cookie)/iu.test(
      userText,
    )
  ) {
    return "user";
  }
  return "angel";
}

function readFailures(result: ConversationRuntimeToolExecutionOutput): readonly string[] {
  const output = isRecord(result.output) ? result.output : {};
  const failures = readStringArray(output, "failures");
  return dedupeStrings([
    ...failures,
    ...(result.error === undefined || result.error.length === 0 ? [] : [result.error]),
  ]);
}

function readNextActions(result: ConversationRuntimeToolExecutionOutput): readonly string[] {
  return isRecord(result.output) ? readStringArray(result.output, "next_actions") : [];
}

function readStringArray(value: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  const items = value[key];
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readRecord(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function readNestedRecord(
  value: Readonly<Record<string, unknown>> | undefined,
  firstKey: string,
  secondKey: string,
): Readonly<Record<string, unknown>> | undefined {
  const first = readRecord(value, firstKey);
  return readRecord(first, secondKey);
}

function readString(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const item = value[key];
  return typeof item === "string" && item.trim().length > 0 ? item.trim() : undefined;
}

function isOpenCliOperationMissing(result: ConversationRuntimeToolExecutionOutput): boolean {
  return /not[-_ ]?found|unknown|missing|没有这个命令|command-not-found|tool executor unavailable/iu.test(
    [result.error, result.content]
      .filter((item): item is string => typeof item === "string")
      .join("\n"),
  );
}

function parseOpenCliReadableSource(
  output: Readonly<Record<string, unknown>>,
  requestedUrl: string,
):
  | {
      readonly url: string;
      readonly title: string;
      readonly body: string;
      readonly source: unknown;
    }
  | undefined {
  const json = output.json;
  const records = Array.isArray(json) ? json.filter(isRecord) : isRecord(json) ? [json] : [];
  const requestedId = extractXStatusId(requestedUrl);
  const primary =
    records.find((record) => extractXStatusId(readString(record, "url") ?? "") === requestedId) ??
    records[0];
  if (primary !== undefined) {
    const body = [
      readString(primary, "body"),
      readString(primary, "text"),
      readString(primary, "content"),
      readString(primary, "full_text"),
    ]
      .filter((item): item is string => item !== undefined && item.trim().length > 0)
      .join("\n\n")
      .trim();
    if (body.length > 0) {
      return {
        url: readString(primary, "url") ?? requestedUrl,
        title: readString(primary, "title") ?? readString(primary, "author") ?? "OpenCLI Twitter/X",
        body,
        source: primary,
      };
    }
  }
  const text = readString(output, "text");
  if (text !== undefined) {
    return {
      url: requestedUrl,
      title: readString(output, "title") ?? "OpenCLI Twitter/X",
      body: text,
      source: output,
    };
  }
  return undefined;
}

function extractXStatusId(value: string): string | undefined {
  return /\/status(?:es)?\/(\d+)/iu.exec(value)?.[1];
}

function isXThreadUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (
      (host === "x.com" ||
        host === "twitter.com" ||
        host.endsWith(".x.com") ||
        host.endsWith(".twitter.com")) &&
      /\/status(?:es)?\/\d+/iu.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function dedupeStrings(items: readonly string[]): readonly string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter((item) => item.length > 0)));
}

function safeSnapshotId(value: string): string {
  return value
    .trim()
    .replace(/:\/\//gu, "-")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
}
