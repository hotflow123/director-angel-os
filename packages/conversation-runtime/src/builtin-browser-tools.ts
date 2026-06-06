import {
  type ConversationRuntimeMediaEvidenceRef,
  createMediaAuthorizationRequest,
  createMediaEvidenceRef,
} from "./learning-artifact.js";
import type { ConversationRuntimeMediaInventory } from "./media-inventory.js";
import type {
  ConversationRuntimeModelToolDefinition,
  ConversationRuntimeToolExecutionInput,
  ConversationRuntimeToolExecutionOutput,
} from "./model-tool-loop.js";

export interface ConversationRuntimeBrowserToolProvider {
  readonly navigate?: (
    input: ConversationRuntimeBrowserNavigateInput,
  ) => Promise<ConversationRuntimeBrowserNavigateOutput> | ConversationRuntimeBrowserNavigateOutput;
  readonly snapshot?: (
    input: ConversationRuntimeBrowserSnapshotInput,
  ) => Promise<ConversationRuntimeBrowserSnapshotOutput> | ConversationRuntimeBrowserSnapshotOutput;
  readonly click?: (
    input: ConversationRuntimeBrowserClickInput,
  ) => Promise<ConversationRuntimeBrowserClickOutput> | ConversationRuntimeBrowserClickOutput;
  readonly type?: (
    input: ConversationRuntimeBrowserTypeInput,
  ) => Promise<ConversationRuntimeBrowserTypeOutput> | ConversationRuntimeBrowserTypeOutput;
  readonly scroll?: (
    input: ConversationRuntimeBrowserScrollInput,
  ) => Promise<ConversationRuntimeBrowserScrollOutput> | ConversationRuntimeBrowserScrollOutput;
  readonly back?: (
    input: ConversationRuntimeBrowserBackInput,
  ) => Promise<ConversationRuntimeBrowserBackOutput> | ConversationRuntimeBrowserBackOutput;
  readonly press?: (
    input: ConversationRuntimeBrowserPressInput,
  ) => Promise<ConversationRuntimeBrowserPressOutput> | ConversationRuntimeBrowserPressOutput;
  readonly getImages?: (
    input: ConversationRuntimeBrowserGetImagesInput,
  ) =>
    | Promise<ConversationRuntimeBrowserGetImagesOutput>
    | ConversationRuntimeBrowserGetImagesOutput;
  readonly console?: (
    input: ConversationRuntimeBrowserConsoleInput,
  ) => Promise<ConversationRuntimeBrowserConsoleOutput> | ConversationRuntimeBrowserConsoleOutput;
}

export interface ConversationRuntimeBrowserBaseInput {
  readonly turnId: string;
  readonly sessionKey: string;
}

export interface ConversationRuntimeBrowserNavigateInput
  extends ConversationRuntimeBrowserBaseInput {
  readonly url: string;
  readonly profile?: string;
}

export interface ConversationRuntimeBrowserSnapshotInput
  extends ConversationRuntimeBrowserBaseInput {
  readonly full: boolean;
  readonly userTask?: string;
  readonly mode?: ConversationRuntimeBrowserSnapshotMode;
  readonly maxChars?: number;
  readonly selector?: string;
  readonly frame?: string;
  readonly labels?: boolean;
  readonly urls?: boolean;
  readonly interactive?: boolean;
  readonly compact?: boolean;
  readonly depth?: number;
  readonly refs?: boolean;
}

export type ConversationRuntimeBrowserSnapshotMode =
  | "compact"
  | "efficient"
  | "readable"
  | "interactive"
  | "full";

export interface ConversationRuntimeBrowserClickInput extends ConversationRuntimeBrowserBaseInput {
  readonly ref: string;
}

export interface ConversationRuntimeBrowserTypeInput extends ConversationRuntimeBrowserBaseInput {
  readonly ref: string;
  readonly text: string;
}

export type ConversationRuntimeBrowserScrollDirection = "up" | "down" | "left" | "right";

export interface ConversationRuntimeBrowserScrollInput extends ConversationRuntimeBrowserBaseInput {
  readonly direction: ConversationRuntimeBrowserScrollDirection;
  readonly pages: number;
}

export interface ConversationRuntimeBrowserBackInput extends ConversationRuntimeBrowserBaseInput {}

export interface ConversationRuntimeBrowserPressInput extends ConversationRuntimeBrowserBaseInput {
  readonly key: string;
}

export interface ConversationRuntimeBrowserGetImagesInput
  extends ConversationRuntimeBrowserBaseInput {}

export interface ConversationRuntimeBrowserConsoleInput
  extends ConversationRuntimeBrowserBaseInput {
  readonly clear: boolean;
  readonly expression?: string;
}

export interface ConversationRuntimeBrowserNavigateOutput {
  readonly success: boolean;
  readonly url?: string;
  readonly title?: string;
  readonly snapshot?: string;
  readonly element_count?: number;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeBrowserSnapshotOutput {
  readonly success: boolean;
  readonly url?: string;
  readonly title?: string;
  readonly snapshot?: string;
  readonly text?: string;
  readonly elements?: readonly ConversationRuntimeBrowserSnapshotElement[];
  readonly element_count?: number;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeBrowserSnapshotElement {
  readonly ref: string;
  readonly role?: string;
  readonly name?: string;
}

export interface ConversationRuntimeBrowserClickOutput {
  readonly success: boolean;
  readonly clicked?: string;
  readonly snapshot?: string;
  readonly element_count?: number;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeBrowserTypeOutput {
  readonly success: boolean;
  readonly element?: string;
  readonly typed?: string;
  readonly snapshot?: string;
  readonly element_count?: number;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeBrowserScrollOutput {
  readonly success: boolean;
  readonly direction?: ConversationRuntimeBrowserScrollDirection;
  readonly pages?: number;
  readonly snapshot?: string;
  readonly element_count?: number;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeBrowserBackOutput {
  readonly success: boolean;
  readonly url?: string;
  readonly title?: string;
  readonly snapshot?: string;
  readonly element_count?: number;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeBrowserPressOutput {
  readonly success: boolean;
  readonly key?: string;
  readonly snapshot?: string;
  readonly element_count?: number;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeBrowserImage {
  readonly src: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
  readonly title?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeBrowserGetImagesOutput {
  readonly success: boolean;
  readonly images?: readonly ConversationRuntimeBrowserImage[];
  readonly image_count?: number;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeBrowserConsoleMessage {
  readonly level: string;
  readonly text: string;
  readonly timestamp?: string;
  readonly source?: string;
}

export interface ConversationRuntimeBrowserConsoleOutput {
  readonly success: boolean;
  readonly result?: unknown;
  readonly messages?: readonly ConversationRuntimeBrowserConsoleMessage[];
  readonly cleared?: boolean;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeBuiltinBrowserToolExecutor = (
  input: ConversationRuntimeToolExecutionInput,
) => Promise<ConversationRuntimeToolExecutionOutput> | ConversationRuntimeToolExecutionOutput;

const BROWSER_SNAPSHOT_DEFAULT_MAX_CHARS = 8_000;
const BROWSER_SNAPSHOT_ABSOLUTE_MAX_CHARS = 200_000;

interface ConversationRuntimeBrowserSnapshotPlan {
  readonly full: boolean;
  readonly mode?: ConversationRuntimeBrowserSnapshotMode;
  readonly max_chars?: number;
  readonly selector?: string;
  readonly frame?: string;
  readonly labels?: boolean;
  readonly urls?: boolean;
  readonly interactive?: boolean;
  readonly compact?: boolean;
  readonly depth?: number;
  readonly refs?: boolean;
}

interface ConversationRuntimeBrowserSnapshotPlanDraft {
  readonly full: boolean;
  readonly mode?: ConversationRuntimeBrowserSnapshotMode | undefined;
  readonly max_chars?: number | undefined;
  readonly selector?: string | undefined;
  readonly frame?: string | undefined;
  readonly labels?: boolean | undefined;
  readonly urls?: boolean | undefined;
  readonly interactive?: boolean | undefined;
  readonly compact?: boolean | undefined;
  readonly depth?: number | undefined;
  readonly refs?: boolean | undefined;
}

export function createBuiltinBrowserTools(): ConversationRuntimeModelToolDefinition[] {
  return [
    {
      name: "browser_navigate",
      description:
        "Navigate to a URL in the browser. Initializes the session and loads the page. Use browser tools when you need to interact with a page, such as clicking, filling forms, or reading dynamic content. Returns a compact page snapshot with interactive elements and ref IDs.",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to navigate to (e.g., 'https://example.com')",
          },
          profile: {
            type: "string",
            description:
              "Optional browser profile: 'angel' for Director Angel's isolated managed Chrome, 'user' only when the user explicitly asks for their real Chrome/Google browser signed-in session, or 'electron' for the built-in public-page browser.",
            enum: ["angel", "user", "electron"],
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
      metadata: {
        capability: "browser.navigate",
        source: "built-in",
        risk: "external-navigation",
      },
    },
    {
      name: "browser_snapshot",
      description:
        "Get a text-based snapshot of the current page's accessibility tree. Returns interactive elements with ref IDs (like @e1, @e2). full=false (default): compact view with interactive elements. full=true: complete page content. Snapshots over 8000 chars are truncated or summarized. Use this before browser actions, after every click/type/press/scroll, and with full=true for complete content.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          full: {
            type: "boolean",
            description:
              "If true, returns complete page content. If false (default), returns compact view with interactive elements only.",
            default: false,
          },
          mode: {
            type: "string",
            enum: ["compact", "efficient", "readable", "interactive", "full"],
            description:
              "Snapshot extraction mode: compact for small navigation state, efficient for mixed text+refs, readable for article content, interactive for action planning, full for complete page text.",
          },
          max_chars: {
            type: "integer",
            description: "Maximum characters to return in the snapshot observation.",
          },
          selector: {
            type: "string",
            description:
              "Optional CSS/accessibility selector hint for the page region to snapshot.",
          },
          frame: {
            type: "string",
            description: "Optional frame hint when the target content is inside a frame.",
          },
          labels: {
            type: "boolean",
            description: "Whether to include human-readable labels for controls and regions.",
          },
          urls: {
            type: "boolean",
            description: "Whether to include visible and referenced URLs.",
          },
          interactive: {
            type: "boolean",
            description: "Whether to include interactive element refs for follow-up actions.",
          },
          compact: {
            type: "boolean",
            description: "Whether the provider should compact boilerplate and repeated navigation.",
          },
          depth: {
            type: "integer",
            description: "Optional DOM/accessibility traversal depth.",
          },
          refs: {
            type: "boolean",
            description: "Whether to include stable ref IDs for interactive elements.",
          },
          reason: {
            type: "string",
            description: "Short runtime reason for why this snapshot is required.",
          },
        },
        additionalProperties: false,
      },
      metadata: {
        capability: "browser.snapshot",
        source: "built-in",
      },
    },
    {
      name: "browser_click",
      description:
        "Click on an element identified by its ref ID from the current page snapshot (e.g., '@e5'). The ref IDs are shown in square brackets in the snapshot output.",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          ref: {
            type: "string",
            description: "The element reference from the snapshot (e.g., '@e5', '@e12')",
          },
        },
        required: ["ref"],
        additionalProperties: false,
      },
      metadata: {
        capability: "browser.click",
        source: "built-in",
        requiresApproval: true,
        risk: "browser-mutation",
      },
    },
    {
      name: "browser_type",
      description:
        "Type text into an input field identified by its ref ID from the current page snapshot. Clears the field first, then types the new text.",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          ref: {
            type: "string",
            description: "The element reference from the snapshot (e.g., '@e3')",
          },
          text: {
            type: "string",
            description: "The text to type into the field",
          },
        },
        required: ["ref", "text"],
        additionalProperties: false,
      },
      metadata: {
        capability: "browser.type",
        source: "built-in",
        requiresApproval: true,
        risk: "browser-mutation",
      },
    },
    {
      name: "browser_scroll",
      description:
        "Scroll the current browser page up, down, left, or right. Useful when the needed content or controls are outside the visible viewport.",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["up", "down", "left", "right"],
            description: "Scroll direction.",
          },
          pages: {
            type: "number",
            description: "How many viewport pages to scroll. Default 1.",
            default: 1,
          },
        },
        required: ["direction"],
        additionalProperties: false,
      },
      metadata: {
        capability: "browser.scroll",
        source: "built-in",
        risk: "browser-mutation",
      },
    },
    {
      name: "browser_back",
      description: "Go back in the current browser history, then return a compact snapshot.",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      metadata: {
        capability: "browser.back",
        source: "built-in",
        risk: "external-navigation",
      },
    },
    {
      name: "browser_press",
      description:
        "Press a keyboard key in the current browser page, such as Enter, Tab, Escape, or ArrowDown.",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "Key to press, e.g. Enter, Tab, Escape, ArrowDown.",
          },
        },
        required: ["key"],
        additionalProperties: false,
      },
      metadata: {
        capability: "browser.press",
        source: "built-in",
        requiresApproval: true,
        risk: "browser-mutation",
      },
    },
    {
      name: "browser_get_images",
      description:
        "Get images visible or referenced on the current browser page, including image URLs, alt text, and dimensions when available.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      metadata: {
        capability: "browser.images",
        source: "built-in",
      },
    },
    {
      name: "browser_console",
      description:
        "Read browser console messages and optionally evaluate a JavaScript expression in the current page context. Use this for silent JS errors, DOM inspection, page state, or extracting structured data.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          clear: {
            type: "boolean",
            description: "If true, clear buffered console messages after reading.",
            default: false,
          },
          expression: {
            type: "string",
            description:
              "Optional JavaScript expression to evaluate in page context, e.g. document.title.",
          },
        },
        additionalProperties: false,
      },
      metadata: {
        capability: "browser.console",
        source: "built-in",
      },
    },
  ];
}

export function createBuiltinBrowserToolExecutors(
  browser?: ConversationRuntimeBrowserToolProvider,
): ReadonlyMap<string, ConversationRuntimeBuiltinBrowserToolExecutor> {
  return new Map<string, ConversationRuntimeBuiltinBrowserToolExecutor>([
    [
      "browser_navigate",
      async (input) => {
        const url = readRequiredString(input.call.args, "url");
        if (url === null) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: "browser_navigate requires a non-empty URL.",
            failures: ["missing url"],
            nextActions: ["retry browser_navigate with an http/https URL"],
          });
        }
        if (!isSafeBrowserUrl(url)) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: "browser_navigate only accepts http/https URLs and about:blank.",
            failures: ["invalid or unsupported URL"],
            nextActions: ["retry with a public http/https URL"],
          });
        }
        if (browser?.navigate === undefined) {
          return createBrowserToolUnavailable(input.call.id, input.call.name);
        }
        const profile = readOptionalString(input.call.args, "profile");
        try {
          const output = await browser.navigate({
            turnId: input.turnId,
            sessionKey: input.sessionKey,
            url,
            ...(profile === undefined ? {} : { profile }),
          });
          return createBrowserNavigateResult(input.call.id, input.call.name, output);
        } catch (error) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: `browser_navigate failed for ${url}.`,
            failures: [toErrorMessage(error)],
            nextActions: ["use web_extract for readable public pages or retry after browser setup"],
          });
        }
      },
    ],
    [
      "browser_snapshot",
      async (input) => {
        if (browser?.snapshot === undefined) {
          return createBrowserToolUnavailable(input.call.id, input.call.name);
        }
        try {
          const userTask = readOptionalString(input.metadata, "userText");
          const snapshotPlan = readBrowserSnapshotPlan(input.call.args);
          const output = await browser.snapshot({
            turnId: input.turnId,
            sessionKey: input.sessionKey,
            full: snapshotPlan.full,
            ...(snapshotPlan.mode === undefined ? {} : { mode: snapshotPlan.mode }),
            ...(snapshotPlan.max_chars === undefined ? {} : { maxChars: snapshotPlan.max_chars }),
            ...(snapshotPlan.selector === undefined ? {} : { selector: snapshotPlan.selector }),
            ...(snapshotPlan.frame === undefined ? {} : { frame: snapshotPlan.frame }),
            ...(snapshotPlan.labels === undefined ? {} : { labels: snapshotPlan.labels }),
            ...(snapshotPlan.urls === undefined ? {} : { urls: snapshotPlan.urls }),
            ...(snapshotPlan.interactive === undefined
              ? {}
              : { interactive: snapshotPlan.interactive }),
            ...(snapshotPlan.compact === undefined ? {} : { compact: snapshotPlan.compact }),
            ...(snapshotPlan.depth === undefined ? {} : { depth: snapshotPlan.depth }),
            ...(snapshotPlan.refs === undefined ? {} : { refs: snapshotPlan.refs }),
            ...(userTask === undefined ? {} : { userTask }),
          });
          return createBrowserSnapshotResult(input.call.id, input.call.name, output, snapshotPlan);
        } catch (error) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: "browser_snapshot failed.",
            failures: [toErrorMessage(error)],
            nextActions: ["call browser_navigate first or use web_extract for static pages"],
          });
        }
      },
    ],
    [
      "browser_click",
      async (input) => {
        const ref = normalizeBrowserRef(readRequiredString(input.call.args, "ref"));
        if (ref === null) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: "browser_click requires a ref from the last browser_snapshot.",
            failures: ["missing ref"],
            nextActions: ["call browser_snapshot and use a returned @e ref"],
          });
        }
        if (browser?.click === undefined) {
          return createBrowserToolUnavailable(input.call.id, input.call.name);
        }
        try {
          return createBrowserClickResult(
            input.call.id,
            input.call.name,
            await browser.click({
              turnId: input.turnId,
              sessionKey: input.sessionKey,
              ref,
            }),
          );
        } catch (error) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: `browser_click failed for ${ref}.`,
            failures: [toErrorMessage(error)],
            nextActions: ["refresh with browser_snapshot and retry with a current ref"],
          });
        }
      },
    ],
    [
      "browser_type",
      async (input) => {
        const ref = normalizeBrowserRef(readRequiredString(input.call.args, "ref"));
        const text = readRequiredString(input.call.args, "text");
        if (ref === null || text === null) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: "browser_type requires ref and text.",
            failures: [ref === null ? "missing ref" : "missing text"],
            nextActions: ["call browser_snapshot and use a returned @e ref"],
          });
        }
        if (browser?.type === undefined) {
          return createBrowserToolUnavailable(input.call.id, input.call.name);
        }
        try {
          return createBrowserTypeResult(
            input.call.id,
            input.call.name,
            await browser.type({
              turnId: input.turnId,
              sessionKey: input.sessionKey,
              ref,
              text,
            }),
          );
        } catch (error) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: `browser_type failed for ${ref}.`,
            failures: [toErrorMessage(error)],
            nextActions: ["refresh with browser_snapshot and retry with a current textbox ref"],
          });
        }
      },
    ],
    [
      "browser_scroll",
      async (input) => {
        const direction = readScrollDirection(input.call.args, "direction");
        if (direction === null) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: "browser_scroll requires direction: up, down, left, or right.",
            failures: ["missing or invalid direction"],
            nextActions: ["retry browser_scroll with direction down/up/left/right"],
          });
        }
        if (browser?.scroll === undefined) {
          return createBrowserToolUnavailable(input.call.id, input.call.name);
        }
        try {
          return createBrowserScrollResult(
            input.call.id,
            input.call.name,
            await browser.scroll({
              turnId: input.turnId,
              sessionKey: input.sessionKey,
              direction,
              pages: readPositiveNumber(input.call.args, "pages") ?? 1,
            }),
          );
        } catch (error) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: `browser_scroll failed (${direction}).`,
            failures: [toErrorMessage(error)],
            nextActions: ["call browser_snapshot to inspect current page state and retry"],
          });
        }
      },
    ],
    [
      "browser_back",
      async (input) => {
        if (browser?.back === undefined) {
          return createBrowserToolUnavailable(input.call.id, input.call.name);
        }
        try {
          return createBrowserBackResult(
            input.call.id,
            input.call.name,
            await browser.back({
              turnId: input.turnId,
              sessionKey: input.sessionKey,
            }),
          );
        } catch (error) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: "browser_back failed.",
            failures: [toErrorMessage(error)],
            nextActions: ["call browser_snapshot or browser_navigate to continue"],
          });
        }
      },
    ],
    [
      "browser_press",
      async (input) => {
        const key = readRequiredString(input.call.args, "key");
        if (key === null) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: "browser_press requires a non-empty key.",
            failures: ["missing key"],
            nextActions: ["retry browser_press with a key such as Enter or Tab"],
          });
        }
        if (browser?.press === undefined) {
          return createBrowserToolUnavailable(input.call.id, input.call.name);
        }
        try {
          return createBrowserPressResult(
            input.call.id,
            input.call.name,
            await browser.press({
              turnId: input.turnId,
              sessionKey: input.sessionKey,
              key,
            }),
          );
        } catch (error) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: `browser_press failed for ${key}.`,
            failures: [toErrorMessage(error)],
            nextActions: ["call browser_snapshot to inspect current focus and retry"],
          });
        }
      },
    ],
    [
      "browser_get_images",
      async (input) => {
        if (browser?.getImages === undefined) {
          return createBrowserToolUnavailable(input.call.id, input.call.name);
        }
        try {
          return createBrowserGetImagesResult(
            input.call.id,
            input.call.name,
            await browser.getImages({
              turnId: input.turnId,
              sessionKey: input.sessionKey,
            }),
          );
        } catch (error) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: "browser_get_images failed.",
            failures: [toErrorMessage(error)],
            nextActions: ["call browser_snapshot to inspect the page and retry"],
          });
        }
      },
    ],
    [
      "browser_console",
      async (input) => {
        if (browser?.console === undefined) {
          return createBrowserToolUnavailable(input.call.id, input.call.name);
        }
        try {
          const expression = readOptionalString(input.call.args, "expression");
          return createBrowserConsoleResult(
            input.call.id,
            input.call.name,
            await browser.console({
              turnId: input.turnId,
              sessionKey: input.sessionKey,
              clear: readBoolean(input.call.args, "clear") ?? false,
              ...(expression === undefined ? {} : { expression }),
            }),
          );
        } catch (error) {
          return createBrowserToolError(input.call.id, input.call.name, {
            summary: "browser_console failed.",
            failures: [toErrorMessage(error)],
            nextActions: ["call browser_snapshot or retry with a simpler expression"],
          });
        }
      },
    ],
  ]);
}

function createBrowserNavigateResult(
  callId: string,
  toolName: string,
  result: ConversationRuntimeBrowserNavigateOutput,
): ConversationRuntimeToolExecutionOutput {
  const snapshot = truncateBrowserSnapshot(result.snapshot ?? "");
  const output = {
    status: result.success ? "success" : "error",
    summary: result.success
      ? `Navigated to ${result.url ?? "the requested URL"}.`
      : (result.error ?? "Navigation failed."),
    url: result.url ?? "",
    title: result.title ?? "",
    snapshot_preview: snapshot,
    element_count: result.element_count ?? 0,
    failures: result.success ? [] : [result.error ?? "Navigation failed."],
    next_actions: result.success
      ? ["browser_snapshot full=true when complete content is needed"]
      : ["use web_extract for readable public pages or retry after browser setup"],
    ...(result.metadata ?? {}),
  };
  return createBrowserToolResult(callId, toolName, result.success, output);
}

function createBrowserSnapshotResult(
  callId: string,
  toolName: string,
  result: ConversationRuntimeBrowserSnapshotOutput,
  snapshotPlan?: ConversationRuntimeBrowserSnapshotPlan,
): ConversationRuntimeToolExecutionOutput {
  const text = truncateBrowserSnapshot(
    result.snapshot ?? result.text ?? "",
    snapshotPlan?.max_chars,
  );
  const elements = Array.isArray(result.elements) ? result.elements : [];
  const elementCount = result.element_count ?? elements.length;
  const emptyHttpSnapshot =
    result.success === true &&
    isHttpBrowserSnapshotUrl(result.url) &&
    text.trim().length === 0 &&
    elementCount === 0;
  const success = result.success === true && !emptyHttpSnapshot;
  const emptySnapshotFailure =
    "Browser snapshot returned no readable text and no interactive elements for a http(s) page.";
  const failure = emptyHttpSnapshot ? emptySnapshotFailure : (result.error ?? "Snapshot failed.");
  const sourceEvidencePayload =
    success && isHttpBrowserSnapshotUrl(result.url)
      ? createBrowserSnapshotSourceEvidencePayload({
          url: result.url ?? "",
          title: result.title ?? "",
          textChars: text.length,
        })
      : {};
  const mediaBoundaryPayload =
    success && shouldAttachBrowserSnapshotMediaBoundary(result.url, text)
      ? createBrowserSnapshotMediaBoundaryPayload(result.url ?? "")
      : {};
  const evidenceDisclosure = mergeBrowserEvidenceDisclosure(
    readRecord(sourceEvidencePayload, "evidence_disclosure"),
    readRecord(mediaBoundaryPayload, "evidence_disclosure"),
  );
  const output = {
    status: success ? "success" : "error",
    summary: success
      ? `Captured browser snapshot with ${elementCount} interactive element(s).`
      : failure,
    url: result.url ?? "",
    title: result.title ?? "",
    text,
    elements,
    element_count: elementCount,
    ...(snapshotPlan === undefined ? {} : { snapshot_plan: snapshotPlan }),
    failures: success ? [] : [failure],
    next_actions: success
      ? ["browser_click @eN", "browser_type @eN", "admit useful text with director.learning.admit"]
      : [
          "call browser_navigate first, use web_extract/OpenCLI for source reading, or report that the page was not read",
        ],
    ...sourceEvidencePayload,
    ...mediaBoundaryPayload,
    ...(evidenceDisclosure === undefined ? {} : { evidence_disclosure: evidenceDisclosure }),
    ...(result.metadata ?? {}),
  };
  const outputRecord: Readonly<Record<string, unknown>> = output;
  return createBrowserToolResult(callId, toolName, success, outputRecord, {
    ...(isRecord(outputRecord.source_snapshot)
      ? { sourceSnapshot: outputRecord.source_snapshot }
      : {}),
    ...(isRecord(outputRecord.external_content)
      ? { externalContent: outputRecord.external_content }
      : {}),
    ...(isRecord(outputRecord.evidence_disclosure)
      ? { evidenceDisclosure: outputRecord.evidence_disclosure }
      : {}),
  });
}

function isHttpBrowserSnapshotUrl(value: string | undefined): boolean {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  try {
    const protocol = new URL(value).protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function createBrowserSnapshotSourceEvidencePayload(input: {
  readonly url: string;
  readonly title: string;
  readonly textChars: number;
}): Readonly<Record<string, unknown>> {
  return {
    source_snapshot: {
      id: `browser-snapshot-${slugifyBrowserEvidenceId(input.url)}`,
      source_kind: "url",
      source_ref: input.url,
      access_status: "available",
      readable_chars: input.textChars,
    },
    external_content: {
      source_url: input.url,
      final_url: input.url,
      title: input.title,
      content_type: "text/plain",
      trust_boundary: "external-browser",
    },
    evidence_disclosure: {
      schemaVersion: "conversation-runtime.browser-snapshot-evidence-disclosure.v1",
      url: input.url,
      title: input.title,
      full_body_chars: input.textChars,
      preview_chars: input.textChars,
      body_truncated_for_model: false,
      media_count: 0,
      persisted: false,
      text_read: true,
      media_understood: false,
      media_understanding_status: "not_understood_without_user_authorization",
      limitation: "浏览器文本已读取；未获授权前不把页面媒体内容当成已理解结论。",
    },
  };
}

function mergeBrowserEvidenceDisclosure(
  sourceDisclosure: Readonly<Record<string, unknown>> | undefined,
  mediaDisclosure: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (sourceDisclosure === undefined) {
    return mediaDisclosure;
  }
  if (mediaDisclosure === undefined) {
    return sourceDisclosure;
  }
  return {
    ...sourceDisclosure,
    ...mediaDisclosure,
  };
}

function shouldAttachBrowserSnapshotMediaBoundary(url: string | undefined, text: string): boolean {
  return isMediaRichSocialBrowserUrl(url) && text.trim().length > 0;
}

function isMediaRichSocialBrowserUrl(value: string | undefined): boolean {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./u, "");
    return (
      host === "x.com" ||
      host === "twitter.com" ||
      host === "mobile.twitter.com" ||
      host.endsWith(".x.com") ||
      host.endsWith(".twitter.com") ||
      host === "weibo.com" ||
      host.endsWith(".weibo.com") ||
      host === "douyin.com" ||
      host.endsWith(".douyin.com") ||
      host === "tiktok.com" ||
      host.endsWith(".tiktok.com") ||
      host === "instagram.com" ||
      host.endsWith(".instagram.com") ||
      host === "youtube.com" ||
      host === "youtu.be" ||
      host.endsWith(".youtube.com") ||
      host === "bilibili.com" ||
      host.endsWith(".bilibili.com")
    );
  } catch {
    return false;
  }
}

function createBrowserSnapshotMediaBoundaryPayload(
  sourceUrl: string,
): Readonly<Record<string, unknown>> {
  const inventory = createUnverifiedBrowserSnapshotMediaInventory(sourceUrl);
  const budget = {
    tokenLimit: 0,
    fileCountLimit: 0,
    videoMinuteLimit: 0,
    audioMinuteLimit: 0,
    estimatedCostTier: "medium",
  };
  return {
    media_inventory: inventory,
    media_understanding_workflow: {
      schemaVersion: "conversation-runtime.media-understanding-workflow.v1",
      status: "authorization_required",
      sourceUrl,
      textEvidenceStatus: "read",
      mediaUnderstandingStatus: "not_understood",
      authorization: {
        mode: "media_inventory",
        question:
          "这个社交页面可能包含图片、视频或音频。是否授权调用视觉/视频/音频工具继续理解媒体内容？",
        request: {
          required: true,
          reason: "browser_snapshot_media_inventory_not_verified",
          assetCount: 0,
          imageCount: 0,
          videoCount: 0,
          audioCount: 0,
          unknownCount: 0,
          defaultMode: "media_inventory",
          recommendedMode: "low_cost",
          estimatedTokenBudget: {
            mediaInventory: 0,
            lowCost: 0,
            deepMultimodal: 0,
          },
          budget,
          estimatedCostTier: "medium",
          privacy: "pii_potential",
          options: [
            {
              mode: "media_inventory",
              label: "只记录媒体清单",
              requiresUserAuthorization: false,
              estimatedTokenBudget: 0,
              estimatedCostTier: "none",
            },
            {
              mode: "low_cost",
              label: "低成本视觉理解",
              requiresUserAuthorization: true,
              estimatedTokenBudget: 0,
              estimatedCostTier: "medium",
            },
            {
              mode: "deep_multimodal",
              label: "深度视频理解",
              requiresUserAuthorization: true,
              estimatedTokenBudget: 0,
              estimatedCostTier: "medium",
            },
          ],
        },
        budget,
      },
      admission: {
        status: "text_admissible_media_not_verified",
        reason: "browser_snapshot_media_not_verified_without_user_authorization",
        canAdmitTextEvidence: true,
        canAdmitMediaContent: false,
        requiredNextAction: "request_user_authorization",
        budget,
        evidenceRefIds: [],
      },
      unauthorizedDisclosure:
        "文本已读；媒体清单未验证，尚未理解图片、视频或音频内容，因此不能把媒体内容当成结论。",
      executionPlan: [],
      evidenceBackfill: {
        admissible: true,
        mediaPublishable: false,
        evidenceRefs: [],
        pendingUnderstandingCount: 0,
      },
    },
    evidence_disclosure: {
      schemaVersion: "conversation-runtime.browser-snapshot-evidence-disclosure.v1",
      url: sourceUrl,
      text_read: true,
      media_understood: false,
      media_understanding_status: "not_understood_without_user_authorization",
      media_inventory_verified: false,
      limitation:
        "文本已读；媒体清单未验证，尚未理解图片、视频或音频内容，因此不能把媒体内容当成结论。",
    },
  };
}

function createUnverifiedBrowserSnapshotMediaInventory(
  sourceUrl: string,
): ConversationRuntimeMediaInventory {
  return {
    schemaVersion: "conversation-runtime.media-inventory.v1",
    sourceUrl,
    assetCount: 0,
    imageCount: 0,
    videoCount: 0,
    audioCount: 0,
    posterCount: 0,
    blobCount: 0,
    unknownCount: 0,
    assets: [],
  };
}

function createBrowserClickResult(
  callId: string,
  toolName: string,
  result: ConversationRuntimeBrowserClickOutput,
): ConversationRuntimeToolExecutionOutput {
  const output = {
    status: result.success ? "success" : "error",
    summary: result.success
      ? `Clicked ${result.clicked ?? "the requested element"}.`
      : (result.error ?? "Click failed."),
    clicked: result.clicked ?? "",
    snapshot_preview: truncateBrowserSnapshot(result.snapshot ?? ""),
    element_count: result.element_count ?? 0,
    failures: result.success ? [] : [result.error ?? "Click failed."],
    next_actions: result.success
      ? ["call browser_snapshot to inspect the updated page"]
      : ["refresh with browser_snapshot and retry with a current ref"],
    ...(result.metadata ?? {}),
  };
  return createBrowserToolResult(callId, toolName, result.success, output);
}

function createBrowserTypeResult(
  callId: string,
  toolName: string,
  result: ConversationRuntimeBrowserTypeOutput,
): ConversationRuntimeToolExecutionOutput {
  const output = {
    status: result.success ? "success" : "error",
    summary: result.success
      ? `Typed text into ${result.element ?? "the requested field"}.`
      : (result.error ?? "Type failed."),
    element: result.element ?? "",
    typed_chars: typeof result.typed === "string" ? result.typed.length : 0,
    snapshot_preview: truncateBrowserSnapshot(result.snapshot ?? ""),
    element_count: result.element_count ?? 0,
    failures: result.success ? [] : [result.error ?? "Type failed."],
    next_actions: result.success
      ? ["call browser_snapshot to inspect the updated page"]
      : ["refresh with browser_snapshot and retry with a current textbox ref"],
    ...(result.metadata ?? {}),
  };
  return createBrowserToolResult(callId, toolName, result.success, output);
}

function createBrowserScrollResult(
  callId: string,
  toolName: string,
  result: ConversationRuntimeBrowserScrollOutput,
): ConversationRuntimeToolExecutionOutput {
  const output = {
    status: result.success ? "success" : "error",
    summary: result.success
      ? `Scrolled ${result.direction ?? "the page"}.`
      : (result.error ?? "Scroll failed."),
    direction: result.direction ?? "",
    pages: result.pages ?? 0,
    snapshot_preview: truncateBrowserSnapshot(result.snapshot ?? ""),
    element_count: result.element_count ?? 0,
    failures: result.success ? [] : [result.error ?? "Scroll failed."],
    next_actions: result.success
      ? ["call browser_snapshot to inspect the updated viewport"]
      : ["call browser_snapshot or browser_navigate before retrying"],
    ...(result.metadata ?? {}),
  };
  return createBrowserToolResult(callId, toolName, result.success, output);
}

function createBrowserBackResult(
  callId: string,
  toolName: string,
  result: ConversationRuntimeBrowserBackOutput,
): ConversationRuntimeToolExecutionOutput {
  const output = {
    status: result.success ? "success" : "error",
    summary: result.success
      ? `Went back to ${result.url ?? "the previous browser page"}.`
      : (result.error ?? "Back navigation failed."),
    url: result.url ?? "",
    title: result.title ?? "",
    snapshot_preview: truncateBrowserSnapshot(result.snapshot ?? ""),
    element_count: result.element_count ?? 0,
    failures: result.success ? [] : [result.error ?? "Back navigation failed."],
    next_actions: result.success
      ? ["call browser_snapshot to inspect the updated page"]
      : ["call browser_navigate to open a page"],
    ...(result.metadata ?? {}),
  };
  return createBrowserToolResult(callId, toolName, result.success, output);
}

function createBrowserPressResult(
  callId: string,
  toolName: string,
  result: ConversationRuntimeBrowserPressOutput,
): ConversationRuntimeToolExecutionOutput {
  const output = {
    status: result.success ? "success" : "error",
    summary: result.success
      ? `Pressed ${result.key ?? "the requested key"}.`
      : (result.error ?? "Key press failed."),
    key: result.key ?? "",
    snapshot_preview: truncateBrowserSnapshot(result.snapshot ?? ""),
    element_count: result.element_count ?? 0,
    failures: result.success ? [] : [result.error ?? "Key press failed."],
    next_actions: result.success
      ? ["call browser_snapshot to inspect the updated page"]
      : ["call browser_snapshot to inspect focus and retry"],
    ...(result.metadata ?? {}),
  };
  return createBrowserToolResult(callId, toolName, result.success, output);
}

function createBrowserGetImagesResult(
  callId: string,
  toolName: string,
  result: ConversationRuntimeBrowserGetImagesOutput,
): ConversationRuntimeToolExecutionOutput {
  const images = Array.isArray(result.images) ? result.images : [];
  const mediaEvidenceRefs = result.success
    ? images.map((image, index) => createListedOnlyImageMediaEvidence(callId, image, index, result))
    : [];
  const mediaAuthorizationRequest = createMediaAuthorizationRequest(mediaEvidenceRefs);
  const output = {
    status: result.success ? "success" : "error",
    summary: result.success
      ? `Found ${result.image_count ?? images.length} image(s) on the page.`
      : (result.error ?? "Image extraction failed."),
    images,
    image_count: result.image_count ?? images.length,
    ...(mediaEvidenceRefs.length === 0
      ? {}
      : {
          media_evidence: mediaEvidenceRefs,
          mediaEvidenceRefs,
          learning_gate: {
            publishable: false,
            reason: "listed_images_are_not_visual_understanding",
            ...(mediaAuthorizationRequest === undefined ? {} : { mediaAuthorizationRequest }),
          },
        }),
    failures: result.success ? [] : [result.error ?? "Image extraction failed."],
    next_actions: result.success
      ? [
          "listed images are not visual understanding",
          "call OCR or a vision-capable media understanding tool before learning image content",
        ]
      : ["call browser_navigate before browser_get_images"],
    ...(result.metadata ?? {}),
  };
  return createBrowserToolResult(callId, toolName, result.success, output, {
    ...(mediaEvidenceRefs.length === 0 ? {} : { mediaEvidenceRefs }),
  });
}

function createBrowserConsoleResult(
  callId: string,
  toolName: string,
  result: ConversationRuntimeBrowserConsoleOutput,
): ConversationRuntimeToolExecutionOutput {
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const output = {
    status: result.success ? "success" : "error",
    summary: result.success
      ? `Read ${messages.length} browser console message(s).`
      : (result.error ?? "Console read failed."),
    result: result.result,
    messages,
    message_count: messages.length,
    cleared: result.cleared === true,
    failures: result.success ? [] : [result.error ?? "Console read failed."],
    next_actions: result.success
      ? ["use console errors or expression result to decide the next browser action"]
      : ["call browser_navigate before browser_console"],
    ...(result.metadata ?? {}),
  };
  return createBrowserToolResult(callId, toolName, result.success, output);
}

function createBrowserToolUnavailable(
  callId: string,
  toolName: string,
): ConversationRuntimeToolExecutionOutput {
  return createBrowserToolResult(callId, toolName, false, {
    status: "error",
    summary: "Browser tool provider is unavailable in this runtime/channel.",
    failures: ["browser provider unavailable"],
    next_actions: [
      "use web_search/web_extract for non-interactive pages",
      "run the same request from the desktop channel when interactive browser automation is required",
    ],
  });
}

function createBrowserToolError(
  callId: string,
  toolName: string,
  input: {
    readonly summary: string;
    readonly failures: readonly string[];
    readonly nextActions: readonly string[];
  },
): ConversationRuntimeToolExecutionOutput {
  return createBrowserToolResult(callId, toolName, false, {
    status: "error",
    summary: input.summary,
    failures: input.failures,
    next_actions: input.nextActions,
  });
}

function createBrowserToolResult(
  callId: string,
  toolName: string,
  ok: boolean,
  output: Readonly<Record<string, unknown>>,
  metadata: Readonly<Record<string, unknown>> = {},
): ConversationRuntimeToolExecutionOutput {
  return {
    callId,
    toolName,
    ok,
    content: formatBrowserToolObservation(output),
    output,
    ...(ok ? {} : { error: String(output.summary ?? "browser tool failed") }),
    metadata: {
      observationFormat: "director.browser-tool-observation.v1",
      ...metadata,
    },
  };
}

function formatBrowserToolObservation(output: Readonly<Record<string, unknown>>): string {
  const lines = [
    `status: ${String(output.status ?? "error")}`,
    `summary: ${String(output.summary ?? "")}`,
  ];
  for (const key of ["url", "title", "clicked", "element"]) {
    const value = output[key];
    if (typeof value === "string" && value.length > 0) {
      lines.push(`${key}: ${value}`);
    }
  }
  for (const key of ["direction", "key"]) {
    const value = output[key];
    if (typeof value === "string" && value.length > 0) {
      lines.push(`${key}: ${value}`);
    }
  }
  for (const key of ["element_count", "typed_chars", "pages", "image_count", "message_count"]) {
    const value = output[key];
    if (typeof value === "number") {
      lines.push(`${key}: ${value}`);
    }
  }
  if ("result" in output) {
    lines.push(`result: ${formatObservationValue(output.result)}`);
  }
  const text = typeof output.text === "string" ? output.text : "";
  if (text.length > 0) {
    lines.push(`text:\n${text}`);
  }
  const snapshotPreview =
    typeof output.snapshot_preview === "string" ? output.snapshot_preview : "";
  if (snapshotPreview.length > 0) {
    lines.push(`snapshot_preview:\n${snapshotPreview}`);
  }
  const elements = Array.isArray(output.elements) ? output.elements : [];
  if (elements.length > 0) {
    lines.push(
      `elements: ${elements
        .slice(0, 50)
        .map((element) =>
          isRecord(element)
            ? [
                readString(element, "ref") ?? "@e?",
                readString(element, "role") ?? "element",
                readString(element, "name") ?? "",
              ]
                .filter((item) => item.length > 0)
                .join(" ")
            : "",
        )
        .filter((item) => item.length > 0)
        .join(" | ")}`,
    );
  }
  const images = Array.isArray(output.images) ? output.images : [];
  if (images.length > 0) {
    lines.push(
      `images: ${images
        .slice(0, 30)
        .map((image) =>
          isRecord(image)
            ? [
                readString(image, "src") ?? "",
                readString(image, "alt") ?? "",
                readNumber(image, "width") === undefined ? "" : `${readNumber(image, "width")}w`,
                readNumber(image, "height") === undefined ? "" : `${readNumber(image, "height")}h`,
              ]
                .filter((item) => item.length > 0)
                .join(" ")
            : "",
        )
        .filter((item) => item.length > 0)
        .join(" | ")}`,
    );
  }
  const mediaEvidence = Array.isArray(output.media_evidence) ? output.media_evidence : [];
  if (mediaEvidence.length > 0) {
    lines.push(
      `media_evidence: ${mediaEvidence
        .slice(0, 30)
        .map((evidence) =>
          isRecord(evidence)
            ? [
                readString(evidence, "id") ?? "",
                readString(evidence, "status") ?? "",
                readString(evidence, "sourceRef") ?? "",
                evidence.realVisualUnderstanding === false ? "not visual understanding" : "",
              ]
                .filter((item) => item.length > 0)
                .join(" ")
            : "",
        )
        .filter((item) => item.length > 0)
        .join(" | ")}`,
    );
  }
  if (isRecord(output.learning_gate)) {
    const mediaAuthorizationRequest = readRecord(output.learning_gate, "mediaAuthorizationRequest");
    if (mediaAuthorizationRequest !== undefined) {
      lines.push(
        `media_authorization: ${[
          readString(mediaAuthorizationRequest, "recommendedMode") ?? "",
          readString(mediaAuthorizationRequest, "estimatedCostTier") ?? "",
          readNumber(mediaAuthorizationRequest, "assetCount") === undefined
            ? ""
            : `${readNumber(mediaAuthorizationRequest, "assetCount")} asset(s)`,
        ]
          .filter((item) => item.length > 0)
          .join(" ")}`,
      );
    }
  }
  const messages = Array.isArray(output.messages) ? output.messages : [];
  if (messages.length > 0) {
    lines.push(
      `messages: ${messages
        .slice(0, 50)
        .map((message) =>
          isRecord(message)
            ? [readString(message, "level") ?? "log", readString(message, "text") ?? ""]
                .filter((item) => item.length > 0)
                .join(" ")
            : "",
        )
        .filter((item) => item.length > 0)
        .join(" | ")}`,
    );
  }
  if (isRecord(output.snapshot_plan)) {
    const planParts = formatSnapshotPlanObservation(output.snapshot_plan);
    if (planParts.length > 0) {
      lines.push(`snapshot_plan: ${planParts.join(" ")}`);
    }
  }
  if (isRecord(output.source_snapshot)) {
    const id = readString(output.source_snapshot, "id");
    if (id !== undefined) {
      lines.push(`source_snapshot: ${id}`);
    }
  }
  if (isRecord(output.evidence_disclosure)) {
    const textRead =
      typeof output.evidence_disclosure.text_read === "boolean"
        ? output.evidence_disclosure.text_read
        : false;
    const mediaUnderstood =
      typeof output.evidence_disclosure.media_understood === "boolean"
        ? output.evidence_disclosure.media_understood
        : false;
    lines.push(`evidence_disclosure: text_read=${textRead} media_understood=${mediaUnderstood}`);
  }
  const failures = Array.isArray(output.failures)
    ? output.failures.filter((item): item is string => typeof item === "string")
    : [];
  if (failures.length > 0) {
    lines.push(`failures: ${failures.join("; ")}`);
  }
  const nextActions = Array.isArray(output.next_actions)
    ? output.next_actions.filter((item): item is string => typeof item === "string")
    : [];
  if (nextActions.length > 0) {
    lines.push(`next_actions: ${nextActions.join("; ")}`);
  }
  return lines.join("\n");
}

function createListedOnlyImageMediaEvidence(
  callId: string,
  image: ConversationRuntimeBrowserImage,
  index: number,
  result: ConversationRuntimeBrowserGetImagesOutput,
): ConversationRuntimeMediaEvidenceRef {
  return createMediaEvidenceRef({
    id: `media-evidence-${slugifyBrowserEvidenceId(callId)}-${index + 1}`,
    sourceRef: image.src,
    status: "listed_only",
    publishable: false,
    metadata: compactBrowserRecord({
      alt: image.alt,
      title: image.title,
      width: image.width,
      height: image.height,
      ...(image.metadata ?? {}),
      pageUrl:
        readString(result.metadata ?? {}, "page_url") ?? readString(result.metadata ?? {}, "url"),
    }),
  });
}

function compactBrowserRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== ""),
  );
}

function slugifyBrowserEvidenceId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
}

function readRequiredString(args: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readOptionalString(
  args: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = args?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readBoolean(args: Readonly<Record<string, unknown>>, key: string): boolean | null {
  const value = args[key];
  return typeof value === "boolean" ? value : null;
}

function readIntegerInRange(
  args: Readonly<Record<string, unknown>>,
  key: string,
  input: { readonly min: number; readonly max: number },
): number | undefined {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const integer = Math.trunc(value);
  return Math.max(input.min, Math.min(input.max, integer));
}

function readBrowserSnapshotMode(
  args: Readonly<Record<string, unknown>>,
): ConversationRuntimeBrowserSnapshotMode | undefined {
  const value = args.mode;
  return value === "compact" ||
    value === "efficient" ||
    value === "readable" ||
    value === "interactive" ||
    value === "full"
    ? value
    : undefined;
}

function readBrowserSnapshotPlan(
  args: Readonly<Record<string, unknown>>,
): ConversationRuntimeBrowserSnapshotPlan {
  return compactSnapshotPlan({
    full: readBoolean(args, "full") ?? false,
    mode: readBrowserSnapshotMode(args),
    max_chars: readIntegerInRange(args, "max_chars", { min: 512, max: 200_000 }),
    selector: readOptionalString(args, "selector"),
    frame: readOptionalString(args, "frame"),
    labels: readBoolean(args, "labels") ?? undefined,
    urls: readBoolean(args, "urls") ?? undefined,
    interactive: readBoolean(args, "interactive") ?? undefined,
    compact: readBoolean(args, "compact") ?? undefined,
    depth: readIntegerInRange(args, "depth", { min: 1, max: 20 }),
    refs: readBoolean(args, "refs") ?? undefined,
  });
}

function compactSnapshotPlan(
  plan: ConversationRuntimeBrowserSnapshotPlanDraft,
): ConversationRuntimeBrowserSnapshotPlan {
  return Object.fromEntries(
    Object.entries(plan).filter(([, value]) => value !== undefined),
  ) as unknown as ConversationRuntimeBrowserSnapshotPlan;
}

function formatSnapshotPlanObservation(plan: Readonly<Record<string, unknown>>): readonly string[] {
  return [
    formatSnapshotPlanValue("full", plan.full),
    formatSnapshotPlanValue("mode", plan.mode),
    formatSnapshotPlanValue("max_chars", plan.max_chars),
    formatSnapshotPlanValue("selector", plan.selector),
    formatSnapshotPlanValue("frame", plan.frame),
    formatSnapshotPlanValue("labels", plan.labels),
    formatSnapshotPlanValue("urls", plan.urls),
    formatSnapshotPlanValue("interactive", plan.interactive),
    formatSnapshotPlanValue("compact", plan.compact),
    formatSnapshotPlanValue("depth", plan.depth),
    formatSnapshotPlanValue("refs", plan.refs),
  ].filter((value): value is string => value !== undefined);
}

function formatSnapshotPlanValue(key: string, value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return `${key}=${value}`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${key}=${String(value)}`;
  }
  return undefined;
}

function readPositiveNumber(args: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(value, 20);
}

function readScrollDirection(
  args: Readonly<Record<string, unknown>>,
  key: string,
): ConversationRuntimeBrowserScrollDirection | null {
  const value = args[key];
  if (value === "up" || value === "down" || value === "left" || value === "right") {
    return value;
  }
  return null;
}

function normalizeBrowserRef(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function truncateBrowserSnapshot(
  value: string,
  maxChars = BROWSER_SNAPSHOT_DEFAULT_MAX_CHARS,
): string {
  const normalized = String(value ?? "").trim();
  const limit = Math.max(512, Math.min(BROWSER_SNAPSHOT_ABSOLUTE_MAX_CHARS, Math.trunc(maxChars)));
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}\n[truncated]`;
}

function isSafeBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.href === "about:blank" || url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function readString(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const item = value[key];
  return typeof item === "string" && item.trim().length > 0 ? item.trim() : undefined;
}

function readNumber(value: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const item = value[key];
  return typeof item === "number" && Number.isFinite(item) ? item : undefined;
}

function readRecord(
  value: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function formatObservationValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
