import { lookup as lookupDns } from "node:dns/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createConversationRuntimeEvidenceProvenanceEnvelope } from "./evidence-provenance.js";
import { createMediaAuthorizationRequest } from "./learning-artifact.js";
import {
  createConversationRuntimeMediaInventory,
  createMediaEvidenceRefsFromInventory,
  createMediaInventoryBudgetSummary,
} from "./media-inventory.js";
import { createMediaUnderstandingWorkflow } from "./media-understanding-workflow.js";
import type {
  ConversationRuntimeModelToolDefinition,
  ConversationRuntimeToolExecutionInput,
  ConversationRuntimeToolExecutionOutput,
} from "./model-tool-loop.js";
import type { ConversationRuntimeArtifactSignal } from "./types.js";

export interface ConversationRuntimeWebSearchProviderInput {
  readonly query: string;
  readonly provider?: ConversationRuntimeWebSearchProviderId;
  readonly sourceType?: ConversationRuntimeWebSearchSourceType;
  readonly reason?: string;
  readonly allowedDomains?: readonly string[];
  readonly blockedDomains?: readonly string[];
  readonly maxResults: number;
}

export type ConversationRuntimeWebSearchProviderId =
  | "auto"
  | "brave"
  | "duckduckgo"
  | "exa"
  | "firecrawl"
  | "sogou-weixin"
  | (string & {});

export type ConversationRuntimeWebSearchSourceType = "web" | "weixin_article" | "official_site";

export interface ConversationRuntimeWebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
  readonly source?: string;
}

export interface ConversationRuntimeWebSearchProviderOutput {
  readonly query: string;
  readonly provider?: ConversationRuntimeWebSearchProviderId | (string & {});
  readonly sourceType?: ConversationRuntimeWebSearchSourceType | (string & {});
  readonly results: readonly ConversationRuntimeWebSearchResult[];
  readonly failures?: readonly string[];
  readonly blocked?: boolean;
  readonly nextActions?: readonly string[];
}

export type ConversationRuntimeWebSearchProvider = (
  input: ConversationRuntimeWebSearchProviderInput,
) =>
  | Promise<ConversationRuntimeWebSearchProviderOutput>
  | ConversationRuntimeWebSearchProviderOutput;

export interface ConversationRuntimeWebExtractProviderInput {
  readonly url: string;
  readonly mode: "auto" | "text" | "markdown" | "browser_fallback";
  readonly maxBytes: number;
}

export interface ConversationRuntimeWebExtractProviderOutput {
  readonly url: string;
  readonly title?: string;
  readonly contentType?: string;
  readonly body: string;
  readonly structuredContent?: Readonly<Record<string, unknown>>;
  readonly extractionReport?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeWebExtractProvider = (
  input: ConversationRuntimeWebExtractProviderInput,
) =>
  | Promise<ConversationRuntimeWebExtractProviderOutput>
  | ConversationRuntimeWebExtractProviderOutput;

export interface ConversationRuntimeWebExtractResolvedHostAddress {
  readonly address: string;
  readonly family?: number;
}

export type ConversationRuntimeWebExtractHostResolver = (input: {
  readonly hostname: string;
  readonly url: string;
}) =>
  | Promise<readonly ConversationRuntimeWebExtractResolvedHostAddress[]>
  | readonly ConversationRuntimeWebExtractResolvedHostAddress[];

export interface ConversationRuntimeWebExtractProviderDescriptor {
  readonly id: string;
  readonly label?: string;
  readonly timeoutMs?: number;
  readonly extract: ConversationRuntimeWebExtractProvider;
}

export interface CreateBuiltinWebToolExecutorsOptions {
  readonly search?: ConversationRuntimeWebSearchProvider;
  readonly extract?: ConversationRuntimeWebExtractProvider;
  readonly extractProviders?: readonly ConversationRuntimeWebExtractProviderDescriptor[];
  readonly resolveExtractHost?: ConversationRuntimeWebExtractHostResolver;
  readonly storeExtractArtifact?: ConversationRuntimeWebExtractArtifactStore;
  readonly readExtractArtifact?: ConversationRuntimeWebExtractArtifactReader;
  readonly fetchImpl?: typeof fetch;
}

export type ConversationRuntimeBuiltinToolExecutor = (
  input: ConversationRuntimeToolExecutionInput,
) => Promise<ConversationRuntimeToolExecutionOutput> | ConversationRuntimeToolExecutionOutput;

export interface ConversationRuntimeWebExtractArtifact {
  readonly schemaVersion: "conversation-runtime.web-extract-artifact.v1";
  readonly bodyRef: string;
  readonly fullBodyRef: string;
  readonly sourceUrl: string;
  readonly finalUrl: string;
  readonly title: string;
  readonly contentType: string;
  readonly body: string;
  readonly textPreview: string;
  readonly fullBodyChars: number;
  readonly previewChars: number;
  readonly createdAtMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeWebExtractArtifactSignal = ConversationRuntimeArtifactSignal & {
  readonly kind: "web-extract-body" | (string & {});
};

export type ConversationRuntimeWebExtractArtifactStore = (
  artifact: ConversationRuntimeWebExtractArtifact,
) =>
  | Promise<ConversationRuntimeWebExtractArtifactSignal>
  | ConversationRuntimeWebExtractArtifactSignal;

export type ConversationRuntimeWebExtractArtifactReader = (input: {
  readonly fullBodyRef: string;
}) =>
  | Promise<ConversationRuntimeWebExtractArtifact | null>
  | ConversationRuntimeWebExtractArtifact
  | null;

export interface FileConversationRuntimeWebExtractArtifactStoreOptions {
  readonly rootDir: string;
  readonly nowMs?: () => number;
}

export interface FileConversationRuntimeWebExtractArtifactReaderOptions {
  readonly rootDir: string;
}

const WEB_EXTRACT_TIMEOUT_MS = 60_000;
const WEB_EXTRACT_MAX_REDIRECTS = 5;
const WEB_EXTRACT_USER_AGENT = "DirectorAngelConversationRuntime/0.1";
const WEB_EXTRACT_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const WEB_EXTRACT_MODEL_BODY_PREVIEW_CHARS = 1200;

type WebExtractProviderAttemptStatus = "success" | "error" | "blocked" | "empty";

interface WebExtractProviderAttemptRecord {
  readonly provider_id: string;
  readonly provider_label?: string;
  readonly status: WebExtractProviderAttemptStatus;
  readonly failure?: string;
  readonly elapsed_ms: number;
  readonly timeout_ms?: number;
  readonly final_url?: string;
  readonly body_chars?: number;
}

export function createBuiltinWebTools(): ConversationRuntimeModelToolDefinition[] {
  return [
    {
      name: "web_search",
      description:
        "Search the public web for current information. Use provider=sogou-weixin and source_type=weixin_article when the user asks for 微信公众号/微信文章/搜狗公众号 results. Returns source candidates only; do not claim that full source content was learned from search snippets alone.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query.",
          },
          provider: {
            type: "string",
            enum: ["auto", "brave", "duckduckgo", "exa", "firecrawl", "sogou-weixin"],
            description:
              "Search backend. Use sogou-weixin for WeChat public account articles; auto defaults to the effective configured web provider.",
          },
          source_type: {
            type: "string",
            enum: ["web", "weixin_article", "official_site"],
            description:
              "Source category requested by the user. Use weixin_article for 微信公众号/微信文章 searches.",
          },
          reason: {
            type: "string",
            description: "Short reason for selecting the provider/source type.",
          },
          allowed_domains: {
            type: "array",
            items: { type: "string" },
            description: "Optional domain allow-list.",
          },
          blocked_domains: {
            type: "array",
            items: { type: "string" },
            description: "Optional domain block-list.",
          },
          max_results: {
            type: "integer",
            description: "Maximum result count, default 5.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      metadata: {
        capability: "web.search",
        source: "built-in",
        observationContract: "status-summary-next_actions",
      },
    },
    {
      name: "web_extract",
      description:
        "Extract readable content from a public URL. Returns a source snapshot only; it does not create learning candidates or long-term memory.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "HTTP/HTTPS URL to extract.",
          },
          mode: {
            type: "string",
            enum: ["auto", "text", "markdown", "browser_fallback"],
            description: "Extraction mode, default auto.",
          },
          max_bytes: {
            type: "integer",
            description: "Maximum bytes/chars to return, default 262144.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
      metadata: {
        capability: "web.extract",
        source: "built-in",
        observationContract: "status-summary-next_actions",
      },
    },
    {
      name: "web_extract_artifact_read",
      description:
        "Read a previously persisted web_extract full body artifact by full_body_ref. Use after web_extract returned body refs/artifacts and only read refs from the configured runtime artifact store.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          full_body_ref: {
            type: "string",
            description: "The full_body_ref returned by web_extract.",
          },
          max_chars: {
            type: "integer",
            description: "Maximum body characters to return to the model, default 4000.",
          },
        },
        required: ["full_body_ref"],
        additionalProperties: false,
      },
      metadata: {
        capability: "web.extract.artifact.read",
        source: "built-in",
        observationContract: "status-summary-next_actions",
      },
    },
  ];
}

export function createBuiltinWebToolExecutors(
  options: CreateBuiltinWebToolExecutorsOptions = {},
): ReadonlyMap<string, ConversationRuntimeBuiltinToolExecutor> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const search = options.search ?? createDefaultWebSearchProvider(fetchImpl);
  const extractProviders = createWebExtractProviderDescriptors({
    fetchImpl,
    ...(options.resolveExtractHost === undefined
      ? {}
      : { resolveHost: options.resolveExtractHost }),
    ...(options.extract === undefined ? {} : { extract: options.extract }),
    ...(options.extractProviders === undefined
      ? {}
      : { extractProviders: options.extractProviders }),
  });
  return new Map<string, ConversationRuntimeBuiltinToolExecutor>([
    [
      "web_search",
      async (input) =>
        executeWebSearchTool({
          input,
          search,
        }),
    ],
    [
      "web_extract",
      async (input) =>
        executeWebExtractTool({
          input,
          extractProviders,
          ...(options.storeExtractArtifact === undefined
            ? {}
            : { storeArtifact: options.storeExtractArtifact }),
        }),
    ],
    [
      "web_extract_artifact_read",
      async (input) =>
        executeWebExtractArtifactReadTool({
          input,
          ...(options.readExtractArtifact === undefined
            ? {}
            : { readArtifact: options.readExtractArtifact }),
        }),
    ],
  ]);
}

export function createFileConversationRuntimeWebExtractArtifactStore(
  options: FileConversationRuntimeWebExtractArtifactStoreOptions,
): ConversationRuntimeWebExtractArtifactStore {
  return (artifact) => {
    const createdAtMs = options.nowMs?.() ?? artifact.createdAtMs;
    const fileName = `${safeWebExtractArtifactFileName(artifact.fullBodyRef)}.json`;
    const filePath = join(options.rootDir, fileName);
    const document: ConversationRuntimeWebExtractArtifact = {
      ...artifact,
      createdAtMs,
      metadata: {
        ...(artifact.metadata ?? {}),
        storage: "file",
      },
    };
    mkdirSync(options.rootDir, { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    return {
      id: artifact.fullBodyRef,
      kind: "web-extract-body",
      title: artifact.title.length > 0 ? artifact.title : artifact.finalUrl,
      path: filePath,
      metadata: {
        bodyRef: artifact.bodyRef,
        fullBodyRef: artifact.fullBodyRef,
        sourceUrl: artifact.sourceUrl,
        finalUrl: artifact.finalUrl,
        fullBodyChars: artifact.fullBodyChars,
        previewChars: artifact.previewChars,
        createdAtMs,
      },
    };
  };
}

export function createFileConversationRuntimeWebExtractArtifactReader(
  options: FileConversationRuntimeWebExtractArtifactReaderOptions,
): ConversationRuntimeWebExtractArtifactReader {
  return ({ fullBodyRef }) => {
    const fileName = `${safeWebExtractArtifactFileName(fullBodyRef)}.json`;
    const filePath = join(options.rootDir, fileName);
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      if (!isWebExtractArtifact(parsed) || parsed.fullBodyRef !== fullBodyRef) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };
}

async function executeWebExtractArtifactReadTool(input: {
  readonly input: ConversationRuntimeToolExecutionInput;
  readonly readArtifact?: ConversationRuntimeWebExtractArtifactReader;
}): Promise<ConversationRuntimeToolExecutionOutput> {
  const fullBodyRef = readRequiredString(input.input.call.args, "full_body_ref");
  if (fullBodyRef === null) {
    return createBuiltinWebToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: false,
      output: {
        status: "error",
        summary: "web_extract_artifact_read requires a non-empty full_body_ref.",
        full_body_ref: "",
        failures: ["missing full_body_ref"],
        next_actions: ["retry with the full_body_ref returned by web_extract"],
      },
      error: "missing full_body_ref",
    });
  }
  if (input.readArtifact === undefined) {
    return createBuiltinWebToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: false,
      output: {
        status: "error",
        summary: "No web extract artifact reader is configured for this runtime.",
        full_body_ref: fullBodyRef,
        failures: ["web extract artifact reader unavailable"],
        next_actions: ["retry after the host runtime configures an artifact reader"],
      },
      error: "web extract artifact reader unavailable",
    });
  }
  const artifact = await input.readArtifact({ fullBodyRef });
  if (artifact === null) {
    return createBuiltinWebToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: false,
      output: {
        status: "error",
        summary: `No saved web_extract artifact was found for ${fullBodyRef}.`,
        full_body_ref: fullBodyRef,
        failures: ["web extract artifact not found"],
        next_actions: ["run web_extract again or use the exact full_body_ref from the tool result"],
      },
      error: "web extract artifact not found",
    });
  }
  const maxChars = readMaxChars(input.input.call.args);
  const body = artifact.body.slice(0, maxChars);
  const truncated = artifact.body.length > body.length;
  return createBuiltinWebToolResult({
    callId: input.input.call.id,
    toolName: input.input.call.name,
    ok: true,
    output: {
      status: "success",
      summary: `Read ${body.length} character(s) from saved web_extract artifact ${fullBodyRef}.`,
      full_body_ref: artifact.fullBodyRef,
      body_ref: artifact.bodyRef,
      url: artifact.finalUrl,
      title: artifact.title,
      content_type: artifact.contentType,
      body,
      returned_chars: body.length,
      full_body_chars: artifact.fullBodyChars,
      body_truncated_for_model: truncated,
      source_snapshot: artifact.metadata?.sourceSnapshot ?? {},
      ...(isRecord(artifact.metadata?.mediaInventory)
        ? { media_inventory: artifact.metadata.mediaInventory }
        : {}),
      ...(Array.isArray(artifact.metadata?.mediaEvidenceRefs)
        ? { mediaEvidenceRefs: artifact.metadata.mediaEvidenceRefs }
        : {}),
      ...(isRecord(artifact.metadata?.mediaAuthorizationRequest)
        ? {
            learning_gate: {
              publishable: false,
              reason: "text_read_but_media_not_understood_without_user_authorization",
              mediaAuthorizationRequest: artifact.metadata.mediaAuthorizationRequest,
            },
          }
        : {}),
      evidence_disclosure: {
        ...(isRecord(artifact.metadata?.evidenceDisclosure)
          ? artifact.metadata.evidenceDisclosure
          : createWebExtractEvidenceDisclosure({
              url: artifact.finalUrl,
              title: artifact.title,
              fullBodyChars: artifact.fullBodyChars,
              previewChars: body.length,
              bodyTruncatedForModel: truncated,
              mediaCount: readMediaInventoryAssetCount(artifact.metadata?.mediaInventory),
              persisted: true,
              secondPassExtracted: true,
            })),
        second_pass_extracted: true,
        secondPassExtracted: true,
      },
      quality: isRecord(artifact.metadata?.quality)
        ? artifact.metadata.quality
        : {
            status: "ok",
            reason: "readable-content",
            publishable: true,
          },
      extraction_report: {
        ...(isRecord(artifact.metadata?.extractionReport)
          ? artifact.metadata.extractionReport
          : {}),
        artifact_read: true,
        returned_chars: body.length,
        body_truncated_for_model: truncated,
      },
      candidate_count: 0,
      next_actions: truncated
        ? ["increase max_chars only when the task needs more exact source text"]
        : ["use this source text for grounded answer or director.learning.admit when requested"],
    },
    metadata: {
      toolOutput: {
        url: artifact.finalUrl,
        title: artifact.title,
        full_body_chars: artifact.fullBodyChars,
        preview_chars: body.length,
        body_truncated_for_model: truncated,
        media_inventory: isRecord(artifact.metadata?.mediaInventory)
          ? artifact.metadata.mediaInventory
          : undefined,
        evidence_disclosure: isRecord(artifact.metadata?.evidenceDisclosure)
          ? artifact.metadata.evidenceDisclosure
          : undefined,
      },
      ...(isRecord(artifact.metadata?.evidenceDisclosure)
        ? { evidenceDisclosure: artifact.metadata.evidenceDisclosure }
        : {}),
      ...(isRecord(artifact.metadata?.evidenceProvenance)
        ? { evidenceProvenance: artifact.metadata.evidenceProvenance }
        : {}),
      ...(isRecord(artifact.metadata?.mediaInventory)
        ? { mediaInventory: artifact.metadata.mediaInventory }
        : {}),
    },
  });
}

async function executeWebSearchTool(input: {
  readonly input: ConversationRuntimeToolExecutionInput;
  readonly search?: ConversationRuntimeWebSearchProvider;
}): Promise<ConversationRuntimeToolExecutionOutput> {
  const query = readRequiredString(input.input.call.args, "query");
  if (query === null) {
    return createBuiltinWebToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: false,
      output: {
        status: "error",
        summary: "web_search requires a non-empty query.",
        query: "",
        results: [],
        failures: ["missing query"],
        next_actions: ["retry web_search with a non-empty query"],
      },
      error: "missing query",
    });
  }
  if (input.search === undefined) {
    return createBuiltinWebToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: false,
      output: {
        status: "error",
        summary: "No web search provider is configured for this runtime.",
        query,
        results: [],
        failures: ["web search provider unavailable"],
        next_actions: ["configure a host search provider or MCP web_search tool"],
      },
      error: "web search provider unavailable",
    });
  }

  try {
    const maxResults = readMaxResults(input.input.call.args);
    const provider = readWebSearchProvider(input.input.call.args);
    const sourceType = readWebSearchSourceType(input.input.call.args, provider);
    const reason = readOptionalString(input.input.call.args, "reason");
    const allowedDomains = readOptionalStringArray(input.input.call.args, "allowed_domains");
    const blockedDomains = readOptionalStringArray(input.input.call.args, "blocked_domains");
    const searchResult = await input.search({
      query,
      provider,
      sourceType,
      ...(reason === undefined ? {} : { reason }),
      maxResults,
      ...(allowedDomains === undefined ? {} : { allowedDomains }),
      ...(blockedDomains === undefined ? {} : { blockedDomains }),
    });
    const results = sanitizeWebSearchResults(searchResult.results).slice(0, maxResults);
    const outputProvider = searchResult.provider ?? provider;
    const outputSourceType = searchResult.sourceType ?? sourceType;
    const output = {
      status:
        searchResult.blocked === true ? "blocked" : results.length === 0 ? "warning" : "success",
      summary:
        searchResult.blocked === true
          ? `Search provider "${outputProvider}" needs verification or manual browser assistance for "${query}".`
          : results.length === 0
            ? `No web search results found for "${query}".`
            : `Found ${results.length} source candidate(s) for "${query}" via ${outputProvider}.`,
      query: searchResult.query,
      provider: outputProvider,
      source_type: outputSourceType,
      results,
      failures: [...(searchResult.failures ?? [])],
      candidate_count: 0,
      result_count: results.length,
      next_actions:
        searchResult.nextActions ??
        (searchResult.blocked === true
          ? ["open Sogou Weixin search in browser for operator verification"]
          : ["extract promising URLs with web_extract"]),
    };
    return createBuiltinWebToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: true,
      output,
    });
  } catch (error) {
    return createBuiltinWebToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: false,
      output: {
        status: "error",
        summary: `Web search failed for "${query}".`,
        query,
        provider: readWebSearchProvider(input.input.call.args),
        source_type: readWebSearchSourceType(
          input.input.call.args,
          readWebSearchProvider(input.input.call.args),
        ),
        results: [],
        failures: [error instanceof Error ? error.message : String(error)],
        next_actions: ["retry later or use a configured MCP/search provider"],
      },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function executeWebExtractTool(input: {
  readonly input: ConversationRuntimeToolExecutionInput;
  readonly extractProviders: readonly ConversationRuntimeWebExtractProviderDescriptor[];
  readonly storeArtifact?: ConversationRuntimeWebExtractArtifactStore;
}): Promise<ConversationRuntimeToolExecutionOutput> {
  const url = readRequiredString(input.input.call.args, "url");
  if (url === null) {
    return createBuiltinWebToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: false,
      output: {
        status: "error",
        summary: "web_extract requires a non-empty URL.",
        url: "",
        failures: ["missing url"],
        next_actions: ["retry web_extract with an http/https URL"],
      },
      error: "missing url",
    });
  }
  const urlSafety = validatePublicWebExtractUrl(url);
  if (!urlSafety.ok) {
    return createBuiltinWebToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: false,
      output: {
        status: urlSafety.status,
        summary: urlSafety.summary,
        url,
        failures: [urlSafety.failure],
        extraction_report: {
          method: "security-gate",
          provider: "conversation-runtime",
          blocked: true,
          security_gate: urlSafety.securityGate,
        },
        candidate_count: 0,
        next_actions: urlSafety.nextActions,
      },
      error: urlSafety.failure,
    });
  }
  if (input.extractProviders.length === 0) {
    return createBuiltinWebToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: false,
      output: {
        status: "error",
        summary: "No web extraction provider is configured for this runtime.",
        url,
        failures: ["web extraction provider unavailable"],
        next_actions: ["configure a host extractor, browser tool, or MCP web_extract tool"],
      },
      error: "web extraction provider unavailable",
    });
  }

  try {
    const mode = readExtractMode(input.input.call.args);
    const maxBytes = readMaxBytes(input.input.call.args);
    const providerAttempts: WebExtractProviderAttemptRecord[] = [];
    let lastRuntimeError: WebExtractRuntimeError | undefined;
    let extracted: ConversationRuntimeWebExtractProviderOutput | undefined;
    let body = "";
    let selectedProvider: ConversationRuntimeWebExtractProviderDescriptor | undefined;
    for (const provider of input.extractProviders) {
      const startedAtMs = Date.now();
      try {
        const nextExtracted = await provider.extract({ url, mode, maxBytes });
        const nextBody = nextExtracted.body.trim();
        if (nextBody.length === 0) {
          lastRuntimeError = undefined;
          providerAttempts.push(
            createWebExtractProviderAttempt({
              provider,
              status: "empty",
              startedAtMs,
              failure: "extracted page body was empty",
              extracted: nextExtracted,
            }),
          );
          continue;
        }
        extracted = nextExtracted;
        body = nextBody;
        selectedProvider = provider;
        providerAttempts.push(
          createWebExtractProviderAttempt({
            provider,
            status: "success",
            startedAtMs,
            extracted: nextExtracted,
            bodyChars: nextBody.length,
          }),
        );
        break;
      } catch (error) {
        const runtimeError = error instanceof WebExtractRuntimeError ? error : undefined;
        lastRuntimeError = runtimeError;
        const failure =
          runtimeError?.failures[0] ?? (error instanceof Error ? error.message : String(error));
        providerAttempts.push(
          createWebExtractProviderAttempt({
            provider,
            status: runtimeError?.status ?? "error",
            startedAtMs,
            failure,
          }),
        );
        if (runtimeError?.status === "blocked") {
          return createWebExtractRuntimeErrorResult({
            input: input.input,
            url,
            error: runtimeError,
            providerAttempts,
          });
        }
      }
    }
    if (extracted === undefined || selectedProvider === undefined) {
      if (lastRuntimeError !== undefined) {
        return createWebExtractRuntimeErrorResult({
          input: input.input,
          url,
          error: lastRuntimeError,
          providerAttempts,
        });
      }
      return createAllWebExtractProvidersFailedResult({
        input: input.input,
        url,
        providerAttempts,
      });
    }
    const clippedBody = body.slice(0, maxBytes);
    const normalizedBody = normalizeWhitespace(clippedBody);
    const textPreview = normalizedBody.slice(0, WEB_EXTRACT_MODEL_BODY_PREVIEW_CHARS);
    const bodyTruncatedForModel = normalizedBody.length > WEB_EXTRACT_MODEL_BODY_PREVIEW_CHARS;
    const previewChars = textPreview.length;
    const fullBodyChars = clippedBody.length;
    const bodyRef = `web-extract-body-${slugifyWebSnapshotId(extracted.url)}`;
    const fullBodyRef = `web-extract-full-body-${slugifyWebSnapshotId(extracted.url)}`;
    const quality = assessExtractedContentQuality({
      url: extracted.url,
      title: extracted.title ?? "",
      body: clippedBody,
      textPreview,
    });
    const externalContent = createExternalContentDescriptor({
      sourceUrl: url,
      finalUrl: extracted.url,
      title: extracted.title ?? "",
      contentType: extracted.contentType ?? "text/plain",
    });
    const sourceSnapshot = createWebExtractSourceSnapshot({
      url: extracted.url,
      accessStatus: quality.status === "blocked" ? "source_access_limited" : "available",
      readableChars: textPreview.length,
    });
    const mediaInventory = createConversationRuntimeMediaInventory({
      body: clippedBody,
      structuredContent: extracted.structuredContent,
      sourceSnapshot,
      extractionReport: extracted.extractionReport,
      sourceUrl: extracted.url,
    });
    const mediaEvidenceRefs = createMediaEvidenceRefsFromInventory(mediaInventory, {
      evidencePrefix: `media-evidence-${slugifyWebSnapshotId(extracted.url)}`,
    });
    const mediaAuthorizationRequest = createMediaAuthorizationRequest(mediaEvidenceRefs);
    const mediaBudget = createMediaInventoryBudgetSummary(mediaInventory);
    const mediaUnderstandingWorkflow = createMediaUnderstandingWorkflow({
      inventory: mediaInventory,
      sourceUrl: extracted.url,
      textRead: true,
      authorization: { mode: "media_inventory" },
      evidencePrefix: `media-evidence-${slugifyWebSnapshotId(extracted.url)}`,
    });
    const evidenceDisclosure = createWebExtractEvidenceDisclosure({
      url: extracted.url,
      title: extracted.title ?? "",
      fullBodyChars,
      previewChars,
      bodyTruncatedForModel,
      mediaCount: mediaInventory.assetCount,
      persisted: false,
      secondPassExtracted: false,
    });
    const sourceSnapshotId = readString(sourceSnapshot, "id");
    const evidenceProvenance = createConversationRuntimeEvidenceProvenanceEnvelope({
      source: {
        kind: "web_extract",
        sourceRef: extracted.url,
        ...(sourceSnapshotId === undefined ? {} : { sourceSnapshotId }),
        textRead: true,
        readableCharacterCount: fullBodyChars,
        secondPassExtracted: false,
      },
      mediaInventory,
      mediaUnderstandingWorkflow,
      evidenceRefIds: sourceSnapshotId === undefined ? [] : [sourceSnapshotId],
      observedAtMs: Date.now(),
    });
    if (quality.status === "blocked") {
      return createBuiltinWebToolResult({
        callId: input.input.call.id,
        toolName: input.input.call.name,
        ok: false,
        output: {
          status: "blocked",
          summary: quality.summary,
          url: extracted.url,
          title: extracted.title ?? "",
          content_type: extracted.contentType ?? "text/plain",
          quality,
          external_content: externalContent,
          source_snapshot: sourceSnapshot,
          structured_content: extracted.structuredContent ?? {},
          media_inventory: mediaInventory,
          ...(mediaEvidenceRefs.length === 0
            ? {}
            : {
                media_evidence: mediaEvidenceRefs,
                mediaEvidenceRefs,
                media_understanding_workflow: mediaUnderstandingWorkflow,
                evidence_provenance: evidenceProvenance,
                learning_gate: {
                  publishable: false,
                  reason: "text_blocked_and_media_not_understood_without_user_authorization",
                  ...(mediaAuthorizationRequest === undefined ? {} : { mediaAuthorizationRequest }),
                },
              }),
          evidence_disclosure: evidenceDisclosure,
          failures: quality.failures,
          extraction_report: {
            method: "fetch",
            readable_chars: textPreview.length,
            raw_chars: body.length,
            quality_gate: quality.reason,
            ...(extracted.extractionReport ?? {}),
            provider: selectedProvider.id,
            ...(selectedProvider.label === undefined
              ? {}
              : { provider_label: selectedProvider.label }),
            provider_attempts: providerAttempts,
            blocked: true,
          },
          candidate_count: 0,
          next_actions: quality.nextActions,
        },
        error: quality.reason,
      });
    }
    const fullBodyArtifact =
      bodyTruncatedForModel && input.storeArtifact !== undefined
        ? await input.storeArtifact({
            schemaVersion: "conversation-runtime.web-extract-artifact.v1",
            bodyRef,
            fullBodyRef,
            sourceUrl: url,
            finalUrl: extracted.url,
            title: extracted.title ?? "",
            contentType: extracted.contentType ?? "text/plain",
            body: clippedBody,
            textPreview,
            fullBodyChars,
            previewChars,
            createdAtMs: Date.now(),
            metadata: {
              sourceSnapshot,
              quality,
              extractionReport: {
                ...(extracted.extractionReport ?? {}),
                provider: selectedProvider.id,
                ...(selectedProvider.label === undefined
                  ? {}
                  : { provider_label: selectedProvider.label }),
                provider_attempts: providerAttempts,
              },
              mediaInventory,
              mediaEvidenceRefs,
              ...(mediaAuthorizationRequest === undefined ? {} : { mediaAuthorizationRequest }),
              mediaUnderstandingWorkflow,
              evidenceProvenance,
              evidenceDisclosure: {
                ...evidenceDisclosure,
                persisted: true,
              },
            },
          })
        : undefined;
    const persistedEvidenceDisclosure = {
      ...evidenceDisclosure,
      persisted: fullBodyArtifact !== undefined,
    };
    const output = {
      status: "success",
      summary: `Extracted ${textPreview.length} preview character(s) from ${extracted.url}.`,
      url: extracted.url,
      title: extracted.title ?? "",
      content_type: extracted.contentType ?? "text/plain",
      text_preview: textPreview,
      body: clippedBody,
      ...(bodyTruncatedForModel
        ? {
            body_ref: bodyRef,
            full_body_ref: fullBodyRef,
            preview_chars: previewChars,
            full_body_chars: fullBodyChars,
            body_truncated_for_model: true,
            ...(fullBodyArtifact === undefined
              ? {}
              : {
                  full_body_artifact: fullBodyArtifact,
                  artifacts: [fullBodyArtifact],
                }),
          }
        : {}),
      quality,
      external_content: externalContent,
      source_snapshot: sourceSnapshot,
      structured_content: extracted.structuredContent ?? {},
      media_inventory: mediaInventory,
      ...(mediaEvidenceRefs.length === 0
        ? {}
        : {
            media_evidence: mediaEvidenceRefs,
            mediaEvidenceRefs,
            media_understanding_workflow: mediaUnderstandingWorkflow,
            evidence_provenance: evidenceProvenance,
            learning_gate: {
              publishable: false,
              reason: "text_read_but_media_not_understood_without_user_authorization",
              ...(mediaAuthorizationRequest === undefined ? {} : { mediaAuthorizationRequest }),
            },
          }),
      evidence_disclosure: persistedEvidenceDisclosure,
      extraction_report: {
        method: "fetch",
        readable_chars: textPreview.length,
        raw_chars: body.length,
        blocked: false,
        truncated: body.length > clippedBody.length,
        ...(bodyTruncatedForModel
          ? {
              preview_chars: previewChars,
              full_body_chars: fullBodyChars,
              body_truncated_for_model: true,
              ...(fullBodyArtifact === undefined
                ? {}
                : { full_body_artifact_id: fullBodyArtifact.id }),
            }
          : {}),
        media_inventory: {
          asset_count: mediaInventory.assetCount,
          image_count: mediaInventory.imageCount,
          video_count: mediaInventory.videoCount,
          audio_count: mediaInventory.audioCount,
          poster_count: mediaInventory.posterCount,
          blob_count: mediaInventory.blobCount,
          unknown_count: mediaInventory.unknownCount,
          budget: mediaBudget,
        },
        ...(extracted.extractionReport ?? {}),
        provider: selectedProvider.id,
        ...(selectedProvider.label === undefined ? {} : { provider_label: selectedProvider.label }),
        provider_attempts: providerAttempts,
      },
      candidate_count: 0,
      next_actions: ["admit with director.learning.admit or inspect with browser_snapshot"],
    };
    return createBuiltinWebToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: true,
      output,
      metadata: {
        toolOutput: output,
        evidenceDisclosure: persistedEvidenceDisclosure,
        mediaInventory,
        mediaEvidenceRefs,
        ...(mediaAuthorizationRequest === undefined ? {} : { mediaAuthorizationRequest }),
        mediaUnderstandingWorkflow,
        evidenceProvenance,
        ...(bodyTruncatedForModel
          ? {
              modelVisibleContent: formatWebToolObservation(output),
              modelVisibleStrategy: "preview-with-body-ref",
              bodyRef,
              fullBodyRef,
              previewChars,
              fullBodyChars,
              ...(fullBodyArtifact === undefined
                ? {}
                : {
                    artifactIds: [fullBodyArtifact.id],
                    artifacts: [fullBodyArtifact],
                  }),
            }
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof WebExtractRuntimeError) {
      return createBuiltinWebToolResult({
        callId: input.input.call.id,
        toolName: input.input.call.name,
        ok: false,
        output: {
          status: error.status,
          summary: error.message,
          url,
          ...(error.redirectUrl === undefined ? {} : { redirect_url: error.redirectUrl }),
          failures: error.failures,
          extraction_report: error.extractionReport,
          candidate_count: 0,
          next_actions: error.nextActions,
        },
        error: error.failures[0] ?? error.message,
      });
    }
    return createBuiltinWebToolResult({
      callId: input.input.call.id,
      toolName: input.input.call.name,
      ok: false,
      output: {
        status: "error",
        summary: `Web extraction failed for ${url}.`,
        url,
        failures: [error instanceof Error ? error.message : String(error)],
        next_actions: ["try browser_navigate/browser_snapshot when available"],
      },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function createWebExtractProviderAttempt(input: {
  readonly provider: ConversationRuntimeWebExtractProviderDescriptor;
  readonly status: WebExtractProviderAttemptStatus;
  readonly startedAtMs: number;
  readonly failure?: string;
  readonly extracted?: ConversationRuntimeWebExtractProviderOutput;
  readonly bodyChars?: number;
}): WebExtractProviderAttemptRecord {
  return {
    provider_id: input.provider.id,
    ...(input.provider.label === undefined ? {} : { provider_label: input.provider.label }),
    status: input.status,
    ...(input.failure === undefined ? {} : { failure: input.failure }),
    elapsed_ms: Math.max(0, Date.now() - input.startedAtMs),
    ...(input.provider.timeoutMs === undefined ? {} : { timeout_ms: input.provider.timeoutMs }),
    ...(input.extracted === undefined ? {} : { final_url: input.extracted.url }),
    ...(input.bodyChars === undefined ? {} : { body_chars: input.bodyChars }),
  };
}

function createAllWebExtractProvidersFailedResult(input: {
  readonly input: ConversationRuntimeToolExecutionInput;
  readonly url: string;
  readonly providerAttempts: readonly WebExtractProviderAttemptRecord[];
}): ConversationRuntimeToolExecutionOutput {
  const failures = readWebExtractProviderAttemptFailures(input.providerAttempts);
  return createBuiltinWebToolResult({
    callId: input.input.call.id,
    toolName: input.input.call.name,
    ok: false,
    output: {
      status: "error",
      summary: `Web extraction failed for ${input.url} after ${input.providerAttempts.length} provider attempt(s).`,
      url: input.url,
      failures,
      extraction_report: {
        method: "provider-fallback",
        blocked: false,
        provider_attempts: input.providerAttempts,
      },
      candidate_count: 0,
      next_actions: ["try browser_navigate/browser_snapshot when available"],
    },
    error: failures[0] ?? "web extraction failed",
  });
}

function createWebExtractRuntimeErrorResult(input: {
  readonly input: ConversationRuntimeToolExecutionInput;
  readonly url: string;
  readonly error: WebExtractRuntimeError;
  readonly providerAttempts: readonly WebExtractProviderAttemptRecord[];
}): ConversationRuntimeToolExecutionOutput {
  return createBuiltinWebToolResult({
    callId: input.input.call.id,
    toolName: input.input.call.name,
    ok: false,
    output: {
      status: input.error.status,
      summary: input.error.message,
      url: input.url,
      ...(input.error.redirectUrl === undefined ? {} : { redirect_url: input.error.redirectUrl }),
      failures: readWebExtractProviderAttemptFailures(input.providerAttempts, input.error.failures),
      extraction_report: {
        ...input.error.extractionReport,
        provider_attempts: input.providerAttempts,
      },
      candidate_count: 0,
      next_actions: input.error.nextActions,
    },
    error: input.error.failures[0] ?? input.error.message,
  });
}

function readWebExtractProviderAttemptFailures(
  attempts: readonly WebExtractProviderAttemptRecord[],
  fallbackFailures: readonly string[] = [],
): readonly string[] {
  const failures = attempts.flatMap((attempt) =>
    attempt.failure === undefined ? [] : [attempt.failure],
  );
  const unique = [...new Set([...failures, ...fallbackFailures])];
  return unique.length === 0 ? ["web extraction provider unavailable"] : unique;
}

function safeWebExtractArtifactFileName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized.length === 0 ? "web-extract-body" : normalized;
}

function isWebExtractArtifact(value: unknown): value is ConversationRuntimeWebExtractArtifact {
  return (
    isRecord(value) &&
    value.schemaVersion === "conversation-runtime.web-extract-artifact.v1" &&
    typeof value.bodyRef === "string" &&
    typeof value.fullBodyRef === "string" &&
    typeof value.sourceUrl === "string" &&
    typeof value.finalUrl === "string" &&
    typeof value.title === "string" &&
    typeof value.contentType === "string" &&
    typeof value.body === "string" &&
    typeof value.textPreview === "string" &&
    typeof value.fullBodyChars === "number" &&
    typeof value.previewChars === "number" &&
    typeof value.createdAtMs === "number"
  );
}

export interface ExtractedContentQualityInput {
  readonly url: string;
  readonly title: string;
  readonly body: string;
  readonly textPreview: string;
}

export type ExtractedContentQualityAssessment =
  | {
      readonly status: "ok";
      readonly reason: "readable-content";
      readonly score: number;
      readonly signals: readonly string[];
      readonly publishable: true;
    }
  | {
      readonly status: "blocked";
      readonly reason: string;
      readonly summary: string;
      readonly score: 0;
      readonly signals: readonly string[];
      readonly publishable: false;
      readonly failures: readonly string[];
      readonly nextActions: readonly string[];
    };

export function assessExtractedContentQuality(
  input: ExtractedContentQualityInput,
): ExtractedContentQualityAssessment {
  const text = normalizeWhitespace([input.title, input.body].filter(Boolean).join(" "));
  const bodyText = normalizeWhitespace(input.body);
  const textPreviewLength = input.textPreview.length;
  const residueSignals = countMatches(text, WEB_EXTRACT_UI_RESIDUE_PATTERNS);
  const accessGateSignals = countMatches(text, WEB_EXTRACT_ACCESS_GATE_PATTERNS);
  const navigationSignals = countMatches(text, WEB_EXTRACT_NAVIGATION_PATTERNS);
  const dynamicShellSignals = countMatches(text, WEB_EXTRACT_DYNAMIC_SHELL_PATTERNS);
  const naturalRunCount = countCjkOrWordRuns(bodyText);
  const weixinHost = parseHostname(input.url) === "mp.weixin.qq.com";
  const hasLongParagraph = hasLongNaturalParagraph(input.body);
  const titleLooksLikeGate =
    /^(微信公众平台|环境异常|请输入验证码|验证码|验证|访问受限|登录(?:\s*[\w/｜|:-]+)?|登录后继续访问)$/iu.test(
      input.title.trim(),
    );
  const hasSuspiciousChrome =
    residueSignals > 0 || accessGateSignals > 0 || navigationSignals >= 4 || titleLooksLikeGate;
  const signals = [
    ...(residueSignals > 0 ? [`residue-signals:${residueSignals}`] : []),
    ...(accessGateSignals > 0 ? ["access-gate:login-or-verification"] : []),
    ...(dynamicShellSignals > 0 ? [`dynamic-shell-signals:${dynamicShellSignals}`] : []),
    ...(navigationSignals > 0 ? [`navigation-signals:${navigationSignals}`] : []),
    ...(hasSuspiciousChrome && textPreviewLength < 180
      ? [`short-preview:${textPreviewLength}`]
      : []),
    ...(hasSuspiciousChrome && !hasLongParagraph ? ["no-long-natural-paragraph"] : []),
    ...(weixinHost ? ["host:mp.weixin.qq.com"] : []),
  ];
  const lowInformationChrome =
    titleLooksLikeGate || (hasSuspiciousChrome && textPreviewLength < 180);
  const looksLikeUiResidue =
    (residueSignals >= 2 || accessGateSignals >= 1) &&
    (lowInformationChrome || (weixinHost && residueSignals >= 3)) &&
    !hasLongParagraph;
  const blockReason =
    dynamicShellSignals >= 2
      ? "dynamic application shell rather than source content"
      : "low-quality extracted content";
  const blockFailure =
    dynamicShellSignals >= 2
      ? "dynamic application shell rather than source content"
      : "low-quality extracted content: page appears to be verification, login, or UI residue instead of article body";
  const contentQualityFailure = summarizeExtractedAccessShellContentQuality(text);
  const blockFailures =
    contentQualityFailure === undefined ? [blockFailure] : [contentQualityFailure, blockFailure];
  if (!looksLikeUiResidue) {
    const looksLikeEmptyVerification =
      (residueSignals >= 1 ||
        accessGateSignals >= 1 ||
        titleLooksLikeGate ||
        /验证|登录|访问受限/iu.test(input.title)) &&
      lowInformationChrome &&
      textPreviewLength < 220 &&
      !hasLongParagraph;
    const looksLikeNavigationOnly =
      navigationSignals >= 4 &&
      textPreviewLength < 260 &&
      naturalRunCount < 35 &&
      !hasLongParagraph;
    const looksLikeDynamicShell =
      dynamicShellSignals >= 2 ||
      (dynamicShellSignals > 0 &&
        !hasLongParagraph &&
        (textPreviewLength < 900 || naturalRunCount < 80));
    if (looksLikeEmptyVerification || looksLikeNavigationOnly || looksLikeDynamicShell) {
      return {
        status: "blocked",
        reason: blockReason,
        summary:
          "Extracted content was blocked or too low-quality to treat as learned source content.",
        score: 0,
        signals,
        publishable: false,
        failures: blockFailures,
        nextActions: [
          "retry with browser_navigate profile=angel and browser_snapshot",
          "use a logged-in user browser profile only when the user explicitly asks for their Chrome session",
        ],
      };
    }
    const score = calculateReadableContentQualityScore({
      previewChars: textPreviewLength,
      naturalRunCount,
      hasLongParagraph,
      navigationSignals,
      residueSignals,
      accessGateSignals,
    });
    return {
      status: "ok",
      reason: "readable-content",
      score,
      signals,
      publishable: true,
    };
  }
  return {
    status: "blocked",
    reason: blockReason,
    summary: "Extracted content was blocked or too low-quality to treat as learned source content.",
    score: 0,
    signals,
    publishable: false,
    failures: blockFailures,
    nextActions: [
      "retry with browser_navigate profile=angel and browser_snapshot",
      "use a logged-in user browser profile only when the user explicitly asks for their Chrome session",
    ],
  };
}

function summarizeExtractedAccessShellContentQuality(sourceContent: string): string | undefined {
  const hasAccessShell =
    /(X 的新用户|立即注册|使用 Google 账号注册|使用 Apple 注册|创建账号|服务条款|Cookie 政策|login required|sign in to continue)/iu.test(
      sourceContent,
    );
  if (!hasAccessShell) {
    return undefined;
  }
  const hasSubstantiveArticleText =
    /(六宫格|九宫格|故事板|Seedance|逐镜头|角色卡|镜头|运镜|时间轴|情绪|工作流|提示词|案例|景深|光比)/iu.test(
      sourceContent,
    );
  if (!hasSubstantiveArticleText) {
    return "抓取内容主要是 X 登录/注册或侧栏信息，不能算成功学习正文。";
  }
  return "正文可用，但夹杂 X 登录/注册、侧栏或回复区噪声，入库前需要清理。";
}

const WEB_EXTRACT_UI_RESIDUE_PATTERNS = [
  /环境异常/iu,
  /完成验证后即可继续访问/iu,
  /轻点两下取消赞/iu,
  /轻点两下取消在看/iu,
  /视频\s+小程序\s+赞/iu,
  /小程序/iu,
  /在看/iu,
] as const;

const WEB_EXTRACT_ACCESS_GATE_PATTERNS = [
  /请输入验证码/iu,
  /验证码/iu,
  /验证后(?:即可|继续)/iu,
  /登录后继续访问/iu,
  /登录后(?:查看|查看更多|浏览|阅读全文|继续).{0,20}(?:内容|全文)?/iu,
  /请先登录/iu,
  /立即注册/iu,
  /使用\s*(?:Google|Apple|微信|QQ|微博).{0,12}(?:注册|登录)/iu,
  /访问受限/iu,
  /访问过于频繁/iu,
  /403 forbidden/iu,
] as const;

const WEB_EXTRACT_DYNAMIC_SHELL_PATTERNS = [
  /Something went wrong,? but don(?:’|')t fret/iu,
  /let(?:’|')s give it another shot/iu,
  /Some privacy related extensions may cause issues/iu,
  /_sentryDebugIds/iu,
  /webpackChunk|__NEXT_DATA__|hydration/iu,
] as const;

const WEB_EXTRACT_NAVIGATION_PATTERNS = [
  /首页/iu,
  /导航/iu,
  /推荐/iu,
  /分享/iu,
  /下载\s*App/iu,
  /注册/iu,
  /登录/iu,
  /广告/iu,
  /评论/iu,
  /关注/iu,
] as const;

function calculateReadableContentQualityScore(input: {
  readonly previewChars: number;
  readonly naturalRunCount: number;
  readonly hasLongParagraph: boolean;
  readonly navigationSignals: number;
  readonly residueSignals: number;
  readonly accessGateSignals: number;
}): number {
  const lengthScore = Math.min(0.55, input.previewChars / 2200);
  const languageScore = Math.min(0.3, input.naturalRunCount / 500);
  const paragraphScore = input.hasLongParagraph ? 0.15 : 0;
  const penalty = Math.min(
    0.4,
    input.navigationSignals * 0.035 + input.residueSignals * 0.06 + input.accessGateSignals * 0.12,
  );
  return Math.max(0.2, Math.min(1, lengthScore + languageScore + paragraphScore - penalty));
}

function createExternalContentDescriptor(input: {
  readonly sourceUrl: string;
  readonly finalUrl: string;
  readonly title: string;
  readonly contentType: string;
}): Readonly<Record<string, unknown>> {
  return {
    source_url: input.sourceUrl,
    final_url: input.finalUrl,
    title: input.title,
    content_type: input.contentType,
    trust_boundary: "external-web",
  };
}

function createWebExtractSourceSnapshot(input: {
  readonly url: string;
  readonly accessStatus: "available" | "source_access_limited";
  readonly readableChars: number;
}): Readonly<Record<string, unknown>> {
  return {
    id: `web-extract-${slugifyWebSnapshotId(input.url)}`,
    source_kind: "url",
    source_ref: input.url,
    access_status: input.accessStatus,
    readable_chars: input.readableChars,
  };
}

function createWebExtractEvidenceDisclosure(input: {
  readonly url: string;
  readonly title: string;
  readonly fullBodyChars: number;
  readonly previewChars: number;
  readonly bodyTruncatedForModel: boolean;
  readonly mediaCount: number;
  readonly persisted: boolean;
  readonly secondPassExtracted: boolean;
}): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: "conversation-runtime.web-extract-evidence-disclosure.v1",
    url: input.url,
    title: input.title,
    full_body_chars: input.fullBodyChars,
    preview_chars: input.previewChars,
    body_truncated_for_model: input.bodyTruncatedForModel,
    media_count: input.mediaCount,
    persisted: input.persisted,
    second_pass_extracted: input.secondPassExtracted,
    secondPassExtracted: input.secondPassExtracted,
    text_read: true,
    media_understood: false,
    media_understanding_status: "not_understood_without_user_authorization",
    limitation:
      "文本已读取；媒体只发现清单，未获授权前未做视觉/视频/音频理解，不能把媒体内容当结论。",
  };
}

function readMediaInventoryAssetCount(value: unknown): number {
  if (!isRecord(value) || typeof value.assetCount !== "number") {
    return 0;
  }
  return Number.isFinite(value.assetCount) ? value.assetCount : 0;
}

function slugifyWebSnapshotId(value: string): string {
  return value
    .trim()
    .replace(/:\/\//gu, "-")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
}

function countMatches(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function hasLongNaturalParagraph(text: string): boolean {
  return text
    .split(/\n{2,}|\r?\n/u)
    .map((line) => normalizeWhitespace(line))
    .some((line) => line.length >= 220 && countCjkOrWordRuns(line) >= 35);
}

function countCjkOrWordRuns(text: string): number {
  const cjkRuns = text.match(/[\p{Script=Han}]/gu)?.length ?? 0;
  const latinWords = text.match(/[a-z0-9]+/giu)?.length ?? 0;
  return cjkRuns + latinWords;
}

function parseHostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLocaleLowerCase();
  } catch {
    return null;
  }
}

function createBuiltinWebToolResult(input: {
  readonly callId: string;
  readonly toolName: string;
  readonly ok: boolean;
  readonly output: Readonly<Record<string, unknown>>;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): ConversationRuntimeToolExecutionOutput {
  return {
    callId: input.callId,
    toolName: input.toolName,
    ok: input.ok,
    content: formatWebToolObservation(input.output),
    output: input.output,
    ...(input.error === undefined ? {} : { error: input.error }),
    metadata: {
      observationFormat: "director.tool-observation.v1",
      ...(input.metadata ?? {}),
    },
  };
}

function formatWebToolObservation(output: Readonly<Record<string, unknown>>): string {
  const lines = [
    `status: ${String(output.status ?? "error")}`,
    `summary: ${String(output.summary ?? "")}`,
  ];
  if (typeof output.query === "string") {
    lines.push(`query: ${output.query}`);
  }
  if (typeof output.provider === "string" && output.provider.length > 0) {
    lines.push(`provider: ${output.provider}`);
  }
  if (typeof output.source_type === "string" && output.source_type.length > 0) {
    lines.push(`source_type: ${output.source_type}`);
  }
  if (typeof output.url === "string" && output.url.length > 0) {
    lines.push(`url: ${output.url}`);
  }
  if (typeof output.title === "string" && output.title.length > 0) {
    lines.push(`title: ${output.title}`);
  }
  if (typeof output.text_preview === "string" && output.text_preview.length > 0) {
    lines.push(`text_preview: ${output.text_preview}`);
  }
  if (isRecord(output.quality)) {
    const status = readString(output.quality, "status") ?? "unknown";
    const score = output.quality.score;
    lines.push(`quality: ${status}${typeof score === "number" ? ` score=${score}` : ""}`);
  }
  if (isRecord(output.source_snapshot)) {
    const id = readString(output.source_snapshot, "id");
    if (id !== undefined) {
      lines.push(`source_snapshot: ${id}`);
    }
  }
  if (isRecord(output.media_inventory)) {
    const assetCount = readNumber(output.media_inventory, "assetCount") ?? 0;
    const imageCount = readNumber(output.media_inventory, "imageCount") ?? 0;
    const videoCount = readNumber(output.media_inventory, "videoCount") ?? 0;
    const audioCount = readNumber(output.media_inventory, "audioCount") ?? 0;
    const posterCount = readNumber(output.media_inventory, "posterCount") ?? 0;
    const blobCount = readNumber(output.media_inventory, "blobCount") ?? 0;
    lines.push(
      `media_inventory: assets=${assetCount} images=${imageCount} videos=${videoCount} audios=${audioCount} posters=${posterCount} blobs=${blobCount}`,
    );
  }
  const mediaAuthorizationRequest = isRecord(output.learning_gate)
    ? readRecord(output.learning_gate, "mediaAuthorizationRequest")
    : undefined;
  if (mediaAuthorizationRequest !== undefined) {
    const budget = readRecord(mediaAuthorizationRequest, "budget");
    const recommendedMode = readString(mediaAuthorizationRequest, "recommendedMode") ?? "unknown";
    const costTier = readString(mediaAuthorizationRequest, "estimatedCostTier") ?? "unknown";
    const tokenLimit = budget === undefined ? undefined : readNumber(budget, "tokenLimit");
    const fileCountLimit = budget === undefined ? undefined : readNumber(budget, "fileCountLimit");
    lines.push(
      [
        `media_authorization: recommended=${recommendedMode}`,
        `cost=${costTier}`,
        ...(tokenLimit === undefined ? [] : [`token_limit=${tokenLimit}`]),
        ...(fileCountLimit === undefined ? [] : [`file_limit=${fileCountLimit}`]),
        "text_read=true media_understood=false",
      ].join(" "),
    );
  }
  if (isRecord(output.evidence_disclosure)) {
    const mediaUnderstood =
      typeof output.evidence_disclosure.media_understood === "boolean"
        ? output.evidence_disclosure.media_understood
        : false;
    const persisted =
      typeof output.evidence_disclosure.persisted === "boolean"
        ? output.evidence_disclosure.persisted
        : false;
    lines.push(`evidence_disclosure: persisted=${persisted} media_understood=${mediaUnderstood}`);
  }
  if (typeof output.body_ref === "string" && output.body_ref.length > 0) {
    lines.push(`body_ref: ${output.body_ref}`);
  }
  if (typeof output.full_body_ref === "string" && output.full_body_ref.length > 0) {
    lines.push(`full_body_ref: ${output.full_body_ref}`);
  }
  if (typeof output.preview_chars === "number") {
    lines.push(`preview_chars: ${output.preview_chars}`);
  }
  if (typeof output.full_body_chars === "number") {
    lines.push(`full_body_chars: ${output.full_body_chars}`);
  }
  if (typeof output.body_truncated_for_model === "boolean") {
    lines.push(`body_truncated_for_model: ${String(output.body_truncated_for_model)}`);
  }
  if (typeof output.candidate_count === "number") {
    lines.push(`candidate_count: ${output.candidate_count}`);
  }
  const results = Array.isArray(output.results) ? output.results : [];
  lines.push(`result_count: ${results.length}`);
  for (const [index, result] of results.entries()) {
    if (!isRecord(result)) {
      continue;
    }
    const title = readString(result, "title") ?? "Untitled";
    const url = readString(result, "url") ?? "";
    const snippet = readString(result, "snippet");
    const source = readString(result, "source");
    lines.push(
      [
        `result_${index + 1}: ${title}`,
        ...(url.length === 0 ? [] : [`url=${url}`]),
        ...(source === undefined ? [] : [`source=${source}`]),
        ...(snippet === undefined ? [] : [`snippet=${snippet}`]),
      ].join(" | "),
    );
  }
  const extractionReport = isRecord(output.extraction_report)
    ? output.extraction_report
    : undefined;
  const providerAttempts = Array.isArray(extractionReport?.provider_attempts)
    ? extractionReport.provider_attempts
    : [];
  if (providerAttempts.length > 0) {
    const summary = providerAttempts
      .filter(isRecord)
      .map((attempt) => {
        const providerId = readString(attempt, "provider_id") ?? "unknown";
        const status = readString(attempt, "status") ?? "unknown";
        return `${providerId}:${status}`;
      })
      .join("; ");
    if (summary.length > 0) {
      lines.push(`provider_attempts: ${summary}`);
    }
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

function readRequiredString(args: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readMaxResults(args: Readonly<Record<string, unknown>>): number {
  const value = args.max_results ?? args.maxResults;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.trunc(value)));
}

function readWebSearchProvider(
  args: Readonly<Record<string, unknown>>,
): ConversationRuntimeWebSearchProviderId {
  const value = args.provider ?? args.search_provider ?? args.searchProvider;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "auto";
}

function readWebSearchSourceType(
  args: Readonly<Record<string, unknown>>,
  provider: ConversationRuntimeWebSearchProviderId,
): ConversationRuntimeWebSearchSourceType {
  const value = args.source_type ?? args.sourceType;
  if (value === "web" || value === "weixin_article" || value === "official_site") {
    return value;
  }
  return provider === "sogou-weixin" ? "weixin_article" : "web";
}

function readOptionalString(
  args: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readExtractMode(
  args: Readonly<Record<string, unknown>>,
): ConversationRuntimeWebExtractProviderInput["mode"] {
  const value = args.mode;
  return value === "text" ||
    value === "markdown" ||
    value === "browser_fallback" ||
    value === "auto"
    ? value
    : "auto";
}

function readMaxBytes(args: Readonly<Record<string, unknown>>): number {
  const value = args.max_bytes ?? args.maxBytes;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 262_144;
  }
  return Math.max(1_024, Math.min(1_000_000, Math.trunc(value)));
}

function readMaxChars(args: Readonly<Record<string, unknown>>): number {
  const value = args.max_chars ?? args.maxChars;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 4_000;
  }
  return Math.max(1, Math.min(64_000, Math.trunc(value)));
}

function readOptionalStringArray(
  args: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | undefined {
  const value = args[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length === 0 ? undefined : items;
}

function normalizeSearchResult(
  result: ConversationRuntimeWebSearchResult,
): ConversationRuntimeWebSearchResult {
  return {
    title: result.title.trim() || result.url,
    url: result.url,
    ...(result.snippet === undefined ? {} : { snippet: result.snippet }),
    source: result.source ?? "provider",
  };
}

function sanitizeWebSearchResults(
  results: readonly ConversationRuntimeWebSearchResult[],
): readonly ConversationRuntimeWebSearchResult[] {
  return dedupeSearchResults(
    results.map(normalizeSearchResult).filter((result) => isReliableWebSearchResult(result)),
  );
}

function isReliableWebSearchResult(result: ConversationRuntimeWebSearchResult): boolean {
  if (result.url.length === 0 || isSearchAdOrTrackingUrl(result.url)) {
    return false;
  }
  if (isLikelySearchAdTitle(result.title)) {
    return false;
  }
  if (result.snippet !== undefined && isLikelySearchAdSnippet(result.snippet)) {
    return false;
  }
  return true;
}

function isSearchAdOrTrackingUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  const host = url.hostname.toLocaleLowerCase();
  const path = url.pathname.toLocaleLowerCase();
  if (
    /duckduckgo\.com$/iu.test(host) &&
    (/\/y\.js$/iu.test(path) || url.searchParams.has("ad_domain"))
  ) {
    return true;
  }
  if (/bing\.com$/iu.test(host) && /\/aclick$/iu.test(path)) {
    return true;
  }
  if (url.searchParams.has("ad_domain") || url.searchParams.has("ad_provider")) {
    return true;
  }
  if (/(^|[?&])(?:utm_|msclkid=|gclid=|fbclid=)/iu.test(url.search)) {
    return true;
  }
  return false;
}

function isLikelySearchAdTitle(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLocaleLowerCase();
  return (
    /\b(?:ad|ads|sponsored)\b/iu.test(normalized) ||
    /\b(?:try|free|generate|create)\b.*\b(?:generator|videos?|images?)\b/iu.test(normalized) ||
    /\b(?:generator|videos?|images?)\b.*\b(?:free|with audio|4 modes)\b/iu.test(normalized)
  );
}

function isLikelySearchAdSnippet(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLocaleLowerCase();
  return (
    /\b(?:try|start|create|generate)\b.*\b(?:free|professional|2k|4k)\b/iu.test(normalized) ||
    /\b(?:limited time|sign up|subscribe|pricing)\b/iu.test(normalized)
  );
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

async function fetchDuckDuckGoWebSearchResults(
  input: ConversationRuntimeWebSearchProviderInput,
  fetchImpl: typeof fetch,
): Promise<ConversationRuntimeWebSearchProviderOutput> {
  const response = await fetchImpl(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`,
    {
      headers: {
        "user-agent": "DirectorAngelConversationRuntime/0.1",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`DuckDuckGo HTML search HTTP ${response.status}`);
  }
  const body = await response.text();
  const htmlResults = parseDuckDuckGoHtml(body);
  return {
    query: input.query,
    provider: "duckduckgo",
    sourceType: input.sourceType ?? "web",
    results: (htmlResults.length > 0 ? htmlResults : parseDuckDuckGoRenderedText(body)).slice(
      0,
      input.maxResults,
    ),
  };
}

function createDefaultWebSearchProvider(
  fetchImpl: typeof fetch,
): ConversationRuntimeWebSearchProvider {
  return async (input) =>
    input.provider === "sogou-weixin" || input.sourceType === "weixin_article"
      ? fetchSogouWeixinSearchResults(input, fetchImpl)
      : fetchDuckDuckGoWebSearchResults(input, fetchImpl);
}

async function fetchSogouWeixinSearchResults(
  input: ConversationRuntimeWebSearchProviderInput,
  fetchImpl: typeof fetch,
): Promise<ConversationRuntimeWebSearchProviderOutput> {
  const url = new URL("https://weixin.sogou.com/weixin");
  url.searchParams.set("type", "2");
  url.searchParams.set("query", input.query);
  const response = await fetchImpl(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) DirectorAngel/0.1 Safari/537.36",
      referer: "https://weixin.sogou.com/",
    },
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`Sogou Weixin search HTTP ${response.status}`);
  }
  if (looksLikeSogouVerificationPage(html, response.url || url.href)) {
    return {
      query: input.query,
      provider: "sogou-weixin",
      sourceType: "weixin_article",
      results: [],
      failures: ["sogou-weixin verification required"],
      blocked: true,
      nextActions: ["open Sogou Weixin search in browser for operator verification"],
    };
  }
  const results = parseSogouWeixinHtml(html).slice(0, input.maxResults);
  return {
    query: input.query,
    provider: "sogou-weixin",
    sourceType: "weixin_article",
    results,
    failures: results.length === 0 ? ["sogou-weixin returned no article results"] : [],
  };
}

function createDefaultWebExtractProvider(
  fetchImpl: typeof fetch,
  resolveHost: ConversationRuntimeWebExtractHostResolver = resolveDefaultWebExtractHost,
): ConversationRuntimeWebExtractProvider {
  return (input) => fetchAndExtractWebPage(input, fetchImpl, resolveHost);
}

async function resolveDefaultWebExtractHost(input: {
  readonly hostname: string;
  readonly url: string;
}): Promise<readonly ConversationRuntimeWebExtractResolvedHostAddress[]> {
  const records = await lookupDns(input.hostname, { all: true, verbatim: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family,
  }));
}

function createWebExtractProviderDescriptors(input: {
  readonly fetchImpl: typeof fetch;
  readonly resolveHost?: ConversationRuntimeWebExtractHostResolver;
  readonly extract?: ConversationRuntimeWebExtractProvider;
  readonly extractProviders?: readonly ConversationRuntimeWebExtractProviderDescriptor[];
}): readonly ConversationRuntimeWebExtractProviderDescriptor[] {
  if (input.extractProviders !== undefined) {
    return input.extractProviders.map((provider, index) => ({
      ...provider,
      id: normalizeWebExtractProviderId(provider.id, index),
    }));
  }
  if (input.extract !== undefined) {
    return [
      {
        id: "configured-extract",
        label: "Configured Extract",
        extract: input.extract,
      },
    ];
  }
  return [
    {
      id: "default-fetch",
      label: "Default Fetch",
      timeoutMs: WEB_EXTRACT_TIMEOUT_MS,
      extract: createDefaultWebExtractProvider(
        input.fetchImpl,
        input.resolveHost ?? selectWebExtractHostResolver(input.fetchImpl),
      ),
    },
  ];
}

function selectWebExtractHostResolver(
  fetchImpl: typeof fetch,
): ConversationRuntimeWebExtractHostResolver {
  return fetchImpl === fetch ? resolveDefaultWebExtractHost : resolveInjectedFetchWebExtractHost;
}

function resolveInjectedFetchWebExtractHost(): readonly ConversationRuntimeWebExtractResolvedHostAddress[] {
  return [{ address: "93.184.216.34", family: 4 }];
}

function normalizeWebExtractProviderId(value: string, index: number): string {
  const trimmed = value.trim();
  return trimmed.length === 0 ? `web-extract-provider-${index + 1}` : trimmed;
}

class WebExtractRuntimeError extends Error {
  readonly status: "blocked" | "error";
  readonly failures: readonly string[];
  readonly nextActions: readonly string[];
  readonly extractionReport: Readonly<Record<string, unknown>>;
  readonly redirectUrl: string | undefined;

  constructor(input: {
    readonly status: "blocked" | "error";
    readonly message: string;
    readonly failures: readonly string[];
    readonly nextActions: readonly string[];
    readonly extractionReport: Readonly<Record<string, unknown>>;
    readonly redirectUrl?: string;
  }) {
    super(input.message);
    this.name = "WebExtractRuntimeError";
    this.status = input.status;
    this.failures = input.failures;
    this.nextActions = input.nextActions;
    this.extractionReport = input.extractionReport;
    this.redirectUrl = input.redirectUrl;
  }
}

interface WebExtractRedirectChainEntry {
  readonly from: string;
  readonly to: string;
  readonly status: number;
  readonly allowed: boolean;
}

async function fetchAndExtractWebPage(
  input: ConversationRuntimeWebExtractProviderInput,
  fetchImpl: typeof fetch,
  resolveHost: ConversationRuntimeWebExtractHostResolver,
): Promise<ConversationRuntimeWebExtractProviderOutput> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_EXTRACT_TIMEOUT_MS);
  let fetched: {
    readonly response: Response;
    readonly finalUrl: string;
    readonly redirectChain: readonly WebExtractRedirectChainEntry[];
  };
  try {
    fetched = await fetchWithManualRedirects({
      url: input.url,
      fetchImpl,
      resolveHost,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new WebExtractRuntimeError({
        status: "error",
        message: `Web extraction timed out after ${WEB_EXTRACT_TIMEOUT_MS / 1000}s for ${input.url}.`,
        failures: [`web extraction timed out after ${WEB_EXTRACT_TIMEOUT_MS / 1000}s`],
        extractionReport: {
          method: "fetch",
          provider: "default-fetch",
          blocked: false,
          security_gate: "fetch-timeout",
          timeout_ms: WEB_EXTRACT_TIMEOUT_MS,
        },
        nextActions: ["try browser_navigate/browser_snapshot when available"],
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const response = fetched.response;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "text/plain";
  const rawResult = await readResponseTextWithLimit(response, input.maxBytes);
  const raw = rawResult.text;
  const htmlExtraction = contentType.includes("html")
    ? extractReadableTextFromHtml(raw, fetched.finalUrl)
    : undefined;
  const body = htmlExtraction?.text ?? raw;
  const title =
    htmlExtraction?.title ?? (contentType.includes("html") ? extractHtmlTitle(raw) : undefined);
  const responseStructuredContent = readResponseStructuredContent(response);
  const htmlMedia =
    contentType.includes("html") && raw.length > 0
      ? extractStructuredMediaFromHtml(raw, fetched.finalUrl)
      : [];
  const structuredContent = mergeWebExtractStructuredContent(responseStructuredContent, htmlMedia);
  return {
    url: fetched.finalUrl,
    ...(title === undefined ? {} : { title }),
    contentType,
    body: body.slice(0, input.maxBytes),
    ...(structuredContent === undefined ? {} : { structuredContent }),
    extractionReport: {
      method: "fetch",
      provider: "default-fetch",
      readable_chars: body.length,
      raw_chars: raw.length,
      bytes_read: rawResult.bytesRead,
      truncated: rawResult.truncated || body.length > input.maxBytes,
      redirect_chain: fetched.redirectChain,
      ...(htmlExtraction === undefined
        ? {}
        : {
            extractor: htmlExtraction.extractor,
            candidate_count: htmlExtraction.candidateCount,
            noise_removed: htmlExtraction.noiseRemoved,
            readability_score: htmlExtraction.readabilityScore,
          }),
      ...(htmlMedia.length === 0
        ? {}
        : {
            html_media_count: htmlMedia.length,
          }),
      blocked: false,
    },
  };
}

function readResponseStructuredContent(
  response: Response,
): Readonly<Record<string, unknown>> | undefined {
  const value = (response as Response & { readonly structuredContent?: unknown }).structuredContent;
  return isRecord(value) ? value : undefined;
}

function mergeWebExtractStructuredContent(
  structuredContent: Readonly<Record<string, unknown>> | undefined,
  htmlMedia: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> | undefined {
  if (htmlMedia.length === 0) {
    return structuredContent;
  }
  const existingMedia = Array.isArray(structuredContent?.media) ? structuredContent.media : [];
  return {
    ...(structuredContent ?? {}),
    media: [...existingMedia, ...htmlMedia],
  };
}

async function fetchWithManualRedirects(input: {
  readonly url: string;
  readonly fetchImpl: typeof fetch;
  readonly resolveHost: ConversationRuntimeWebExtractHostResolver;
  readonly signal: AbortSignal;
}): Promise<{
  readonly response: Response;
  readonly finalUrl: string;
  readonly redirectChain: readonly WebExtractRedirectChainEntry[];
}> {
  let currentUrl = input.url;
  const redirectChain: WebExtractRedirectChainEntry[] = [];
  for (let depth = 0; depth <= WEB_EXTRACT_MAX_REDIRECTS; depth += 1) {
    const safety = validatePublicWebExtractUrl(currentUrl);
    if (!safety.ok) {
      throw webExtractSecurityErrorFromUrlSafety(currentUrl, safety, redirectChain);
    }
    await assertPublicWebExtractResolvedHost({
      url: currentUrl,
      resolveHost: input.resolveHost,
      redirectChain,
    });
    const response = await input.fetchImpl(currentUrl, {
      redirect: "manual",
      signal: input.signal,
      headers: {
        "user-agent": WEB_EXTRACT_USER_AGENT,
      },
    });
    const responseStatus = normalizeResponseStatus(response.status);
    if (!WEB_EXTRACT_REDIRECT_STATUSES.has(responseStatus)) {
      const finalUrl = normalizeFinalResponseUrl(response.url || currentUrl, currentUrl);
      const finalSafety = validatePublicWebExtractUrl(finalUrl);
      if (!finalSafety.ok) {
        throw webExtractSecurityErrorFromUrlSafety(finalUrl, finalSafety, redirectChain);
      }
      if (finalUrl !== currentUrl) {
        await assertPublicWebExtractResolvedHost({
          url: finalUrl,
          resolveHost: input.resolveHost,
          redirectChain,
          redirectEntry: {
            from: currentUrl,
            to: finalUrl,
            status: responseStatus,
            allowed: false,
          },
        });
      }
      if (!isPermittedWebExtractRedirect(currentUrl, finalUrl)) {
        throw createCrossHostRedirectError({
          requestedUrl: currentUrl,
          redirectUrl: finalUrl,
          status: responseStatus,
          redirectChain,
        });
      }
      return {
        response,
        finalUrl,
        redirectChain,
      };
    }
    const location = response.headers.get("location");
    if (location === null || location.trim().length === 0) {
      throw new WebExtractRuntimeError({
        status: "error",
        message: `Web extraction hit HTTP ${responseStatus} redirect without a Location header.`,
        failures: [`HTTP ${responseStatus} redirect missing Location header`],
        extractionReport: {
          method: "fetch",
          provider: "default-fetch",
          blocked: false,
          security_gate: "redirect-missing-location",
          redirect_chain: redirectChain,
        },
        nextActions: ["try browser_navigate/browser_snapshot when available"],
      });
    }
    const redirectUrl = normalizeFinalResponseUrl(location, currentUrl);
    const redirectSafety = validatePublicWebExtractUrl(redirectUrl);
    if (!redirectSafety.ok) {
      throw webExtractSecurityErrorFromUrlSafety(redirectUrl, redirectSafety, [
        ...redirectChain,
        { from: currentUrl, to: redirectUrl, status: responseStatus, allowed: false },
      ]);
    }
    await assertPublicWebExtractResolvedHost({
      url: redirectUrl,
      resolveHost: input.resolveHost,
      redirectChain,
      redirectEntry: {
        from: currentUrl,
        to: redirectUrl,
        status: responseStatus,
        allowed: false,
      },
    });
    if (!isPermittedWebExtractRedirect(currentUrl, redirectUrl)) {
      throw createCrossHostRedirectError({
        requestedUrl: currentUrl,
        redirectUrl,
        status: responseStatus,
        redirectChain,
      });
    }
    redirectChain.push({
      from: currentUrl,
      to: redirectUrl,
      status: responseStatus,
      allowed: true,
    });
    currentUrl = redirectUrl;
  }

  throw new WebExtractRuntimeError({
    status: "error",
    message: `Web extraction exceeded ${WEB_EXTRACT_MAX_REDIRECTS} redirects.`,
    failures: [`too many redirects: exceeded ${WEB_EXTRACT_MAX_REDIRECTS}`],
    extractionReport: {
      method: "fetch",
      provider: "default-fetch",
      blocked: false,
      security_gate: "too-many-redirects",
      redirect_chain: redirectChain,
    },
    nextActions: ["inspect the URL in browser before retrying extraction"],
  });
}

async function assertPublicWebExtractResolvedHost(input: {
  readonly url: string;
  readonly resolveHost: ConversationRuntimeWebExtractHostResolver;
  readonly redirectChain: readonly WebExtractRedirectChainEntry[];
  readonly redirectEntry?: WebExtractRedirectChainEntry;
}): Promise<void> {
  const parsedUrl = new URL(input.url);
  const hostname = parsedUrl.hostname;
  const redirectChain = createWebExtractDnsRedirectChain(input);
  let resolved: readonly ConversationRuntimeWebExtractResolvedHostAddress[];
  try {
    resolved = await input.resolveHost({ hostname, url: input.url });
  } catch (error) {
    throw new WebExtractRuntimeError({
      status: "error",
      message: `DNS resolution failed for ${hostname}.`,
      failures: [`DNS resolution failed for ${hostname}: ${readErrorMessage(error)}`],
      extractionReport: {
        method: "security-gate",
        provider: "conversation-runtime",
        blocked: false,
        security_gate: "dns-resolution-failed",
        hostname,
        redirect_chain: redirectChain,
      },
      ...(input.redirectEntry === undefined ? {} : { redirectUrl: input.url }),
      nextActions: ["retry later or use browser_navigate/browser_snapshot when available"],
    });
  }
  const addresses = resolved
    .map((address) => ({
      address: address.address.trim(),
      ...(address.family === undefined ? {} : { family: address.family }),
    }))
    .filter((address) => address.address.length > 0);
  if (addresses.length === 0) {
    throw new WebExtractRuntimeError({
      status: "error",
      message: `DNS resolution returned no addresses for ${hostname}.`,
      failures: [`DNS resolution returned no addresses for ${hostname}`],
      extractionReport: {
        method: "security-gate",
        provider: "conversation-runtime",
        blocked: false,
        security_gate: "dns-resolution-empty",
        hostname,
        redirect_chain: redirectChain,
      },
      ...(input.redirectEntry === undefined ? {} : { redirectUrl: input.url }),
      nextActions: ["retry later or use browser_navigate/browser_snapshot when available"],
    });
  }
  const blockedAddress = addresses.find((address) =>
    hostnameLooksPrivateOrInternal(address.address),
  );
  if (blockedAddress !== undefined) {
    throw new WebExtractRuntimeError({
      status: "blocked",
      message: `web_extract blocked ${input.url} because ${hostname} resolved to a private or internal network address.`,
      failures: [
        `resolved to a private or internal network address: ${hostname} -> ${blockedAddress.address}`,
      ],
      extractionReport: {
        method: "security-gate",
        provider: "conversation-runtime",
        blocked: true,
        security_gate: "blocked-private-or-internal-resolved-address",
        hostname,
        resolved_addresses: addresses,
        redirect_chain: redirectChain,
      },
      ...(input.redirectEntry === undefined ? {} : { redirectUrl: input.url }),
      nextActions: [
        "use browser tools only when the user explicitly asks for that local/private page",
      ],
    });
  }
}

function createWebExtractDnsRedirectChain(input: {
  readonly redirectChain: readonly WebExtractRedirectChainEntry[];
  readonly redirectEntry?: WebExtractRedirectChainEntry;
}): readonly WebExtractRedirectChainEntry[] {
  return input.redirectEntry === undefined
    ? input.redirectChain
    : [...input.redirectChain, input.redirectEntry];
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeResponseStatus(status: number): number {
  return Number.isFinite(status) ? Math.trunc(status) : 0;
}

function normalizeFinalResponseUrl(value: string, baseUrl: string): string {
  return new URL(value, baseUrl).toString();
}

function createCrossHostRedirectError(input: {
  readonly requestedUrl: string;
  readonly redirectUrl: string;
  readonly status: number;
  readonly redirectChain: readonly WebExtractRedirectChainEntry[];
}): WebExtractRuntimeError {
  const redirectEntry = {
    from: input.requestedUrl,
    to: input.redirectUrl,
    status: input.status,
    allowed: false,
  };
  return new WebExtractRuntimeError({
    status: "blocked",
    message: `Web extraction blocked a cross-host redirect from ${input.requestedUrl} to ${input.redirectUrl}.`,
    failures: ["blocked cross-host redirect"],
    redirectUrl: input.redirectUrl,
    extractionReport: {
      method: "fetch",
      provider: "default-fetch",
      blocked: true,
      security_gate: "blocked-cross-host-redirect",
      redirect_chain: [...input.redirectChain, redirectEntry],
    },
    nextActions: ["call web_extract on the redirected URL only if the user explicitly trusts it"],
  });
}

function webExtractSecurityErrorFromUrlSafety(
  url: string,
  safety: Exclude<WebExtractUrlSafety, { readonly ok: true }>,
  redirectChain: readonly WebExtractRedirectChainEntry[],
): WebExtractRuntimeError {
  return new WebExtractRuntimeError({
    status: safety.status,
    message: safety.summary,
    failures: [safety.failure],
    extractionReport: {
      method: "security-gate",
      provider: "conversation-runtime",
      blocked: true,
      security_gate: safety.securityGate,
      redirect_chain: redirectChain,
    },
    nextActions: safety.nextActions,
    ...(url === "" ? {} : { redirectUrl: url }),
  });
}

function isPermittedWebExtractRedirect(originalUrl: string, redirectUrl: string): boolean {
  try {
    const original = new URL(originalUrl);
    const redirect = new URL(redirectUrl);
    if (original.protocol !== redirect.protocol || original.port !== redirect.port) {
      return false;
    }
    if (redirect.username.length > 0 || redirect.password.length > 0) {
      return false;
    }
    const stripWww = (value: string) => value.toLocaleLowerCase().replace(/^www\./u, "");
    return stripWww(original.hostname) === stripWww(redirect.hostname);
  } catch {
    return false;
  }
}

async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ readonly text: string; readonly bytesRead: number; readonly truncated: boolean }> {
  const body = (response as unknown as { readonly body?: unknown }).body;
  if (isReadableStreamBody(body)) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;
    let truncated = false;
    try {
      while (true) {
        const read = await reader.read();
        if (read.done === true) {
          break;
        }
        const chunk = normalizeReadableChunk(read.value);
        const remaining = maxBytes - bytesRead;
        if (chunk.byteLength > remaining) {
          chunks.push(chunk.slice(0, Math.max(0, remaining)));
          bytesRead = maxBytes;
          truncated = true;
          break;
        }
        chunks.push(chunk);
        bytesRead += chunk.byteLength;
      }
    } finally {
      if (truncated) {
        await reader.cancel().catch(() => undefined);
      }
    }
    return {
      text: new TextDecoder("utf-8").decode(concatUint8Arrays(chunks, bytesRead)),
      bytesRead,
      truncated,
    };
  }

  const text = await response.text();
  const truncated = text.length > maxBytes;
  return {
    text: truncated ? text.slice(0, maxBytes) : text,
    bytesRead: Math.min(text.length, maxBytes),
    truncated,
  };
}

function isReadableStreamBody(
  value: unknown,
): value is ReadableStream<Uint8Array | ArrayBuffer | string> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getReader" in value &&
    typeof (value as { readonly getReader?: unknown }).getReader === "function"
  );
}

function normalizeReadableChunk(value: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  return new Uint8Array(value);
}

function concatUint8Arrays(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function isAbortLikeError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

interface HtmlReadableExtraction {
  readonly text: string;
  readonly title?: string;
  readonly extractor: "wechat-rich-media" | "readability-candidate" | "basic-html";
  readonly candidateCount: number;
  readonly noiseRemoved: boolean;
  readonly readabilityScore: number;
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu);
  if (match === null) {
    return undefined;
  }
  const title = normalizeWhitespace(match[1] ?? "");
  return title.length === 0 ? undefined : title;
}

function extractReadableTextFromHtml(html: string, url: string): HtmlReadableExtraction {
  const title = extractHtmlTitle(html);
  const withoutScripts = stripNonContentHtml(html);
  const source = stripHtmlComments(withoutScripts);
  const candidates = collectHtmlReadableCandidates(source, url);
  const best = candidates[0];
  if (best !== undefined && best.score >= 40 && best.text.length >= 40) {
    return {
      text: best.text,
      ...(title === undefined ? {} : { title }),
      extractor: best.extractor,
      candidateCount: candidates.length,
      noiseRemoved: true,
      readabilityScore: best.score,
    };
  }
  const fallback = htmlFragmentToReadableText(stripStructuralNoiseHtml(source));
  return {
    text: fallback,
    ...(title === undefined ? {} : { title }),
    extractor: "basic-html",
    candidateCount: candidates.length,
    noiseRemoved: fallback.length !== htmlFragmentToReadableText(source).length,
    readabilityScore: scoreReadableText(fallback),
  };
}

interface HtmlReadableCandidate {
  readonly extractor: "wechat-rich-media" | "readability-candidate";
  readonly text: string;
  readonly score: number;
  readonly order: number;
}

function collectHtmlReadableCandidates(
  html: string,
  url: string,
): readonly HtmlReadableCandidate[] {
  const candidates: HtmlReadableCandidate[] = [];
  let order = 0;
  const addCandidate = (
    extractor: HtmlReadableCandidate["extractor"],
    fragment: string,
    weight: number,
  ) => {
    const cleaned = stripStructuralNoiseHtml(fragment);
    const text = htmlFragmentToReadableText(cleaned);
    if (text.length === 0) {
      return;
    }
    const score = scoreReadableText(text) + weight;
    candidates.push({
      extractor,
      text,
      score,
      order,
    });
    order += 1;
  };

  for (const fragment of extractHtmlElementsByAttribute(
    html,
    "id",
    /^(?:js_content|activity-detail)$/iu,
  )) {
    addCandidate("wechat-rich-media", fragment, 90);
  }
  for (const fragment of extractHtmlElementsByAttribute(
    html,
    "class",
    /(?:rich_media_content|article-content|article_content|post-content|post_content|entry-content|entry_content|content-block|main-content|main_content)/iu,
  )) {
    addCandidate(
      /mp\.weixin\.qq\.com/iu.test(url) ? "wechat-rich-media" : "readability-candidate",
      fragment,
      70,
    );
  }
  for (const fragment of extractHtmlElementsByTag(html, "article")) {
    addCandidate("readability-candidate", fragment, 80);
  }
  for (const fragment of extractHtmlElementsByTag(html, "main")) {
    addCandidate("readability-candidate", fragment, 65);
  }
  for (const fragment of extractHtmlElementsByAttribute(html, "role", /^main$/iu)) {
    addCandidate("readability-candidate", fragment, 65);
  }
  for (const tag of ["section", "div"] as const) {
    for (const fragment of extractHtmlElementsByTag(html, tag)) {
      addCandidate("readability-candidate", fragment, tag === "section" ? 20 : 0);
    }
  }

  return candidates
    .filter((candidate) => candidate.score >= 25)
    .sort((a, b) => b.score - a.score || a.order - b.order);
}

function stripNonContentHtml(html: string): string {
  return html
    .replace(/<!doctype[\s\S]*?>/giu, " ")
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/giu, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/giu, " ")
    .replace(/<canvas\b[\s\S]*?<\/canvas>/giu, " ")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/giu, " ");
}

function stripStructuralNoiseHtml(html: string): string {
  let cleaned = html;
  for (const tag of [
    "nav",
    "header",
    "footer",
    "aside",
    "form",
    "button",
    "dialog",
    "figure",
    "figcaption",
    "iframe",
  ]) {
    cleaned = removeHtmlElementsByTag(cleaned, tag);
  }
  cleaned = removeHtmlElementsByAttribute(
    cleaned,
    "class",
    /(?:comment|comments|reply|sidebar|related|recommend|ad-|advert|share|social|login|signup|qrcode|qr_code|copyright|footer|nav|breadcrumb|toolbar|modal|popup|subscribe)/iu,
  );
  cleaned = removeHtmlElementsByAttribute(
    cleaned,
    "id",
    /(?:comment|comments|reply|sidebar|related|recommend|ad_|advert|share|social|login|signup|qrcode|qr_code|copyright|footer|nav|breadcrumb|toolbar|modal|popup|subscribe|js_top_ad_area|js_pc_qr_code)/iu,
  );
  return cleaned;
}

function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/gu, " ");
}

function htmlFragmentToReadableText(html: string): string {
  let text = html
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/giu, (_match, label: string) =>
      htmlFragmentToReadableText(label),
    )
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu, (_match, _level: string, body: string) => {
      const label = stripInlineHtml(body);
      return label.length === 0 ? "\n" : `\n${label}\n`;
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/giu, (_match, body: string) => {
      const label = stripInlineHtml(body);
      return label.length === 0 ? "\n" : `\n- ${label}`;
    })
    .replace(/<(?:br|hr)\b[^>]*\/?>/giu, "\n")
    .replace(/<\/(?:p|div|section|article|main|blockquote|tr|table|ul|ol)>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");
  text = decodeHtmlEntity(text)
    .replace(/\r/gu, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return text;
}

function stripInlineHtml(html: string): string {
  return normalizeWhitespace(html.replace(/<[^>]+>/gu, " "));
}

function scoreReadableText(text: string): number {
  const normalized = normalizeWhitespace(text);
  if (normalized.length === 0) {
    return 0;
  }
  const paragraphs = text
    .split(/\n{1,}/u)
    .map((item) => normalizeWhitespace(item))
    .filter((item) => item.length >= 18);
  const cjkOrWords = countCjkOrWordRuns(normalized);
  const punctuation = countMatches(normalized, [/。/u, /，/u, /；/u, /：/u, /\./u, /,/u]);
  const noise = countMatches(normalized, [
    /登录|注册|下载|推荐|猜你喜欢|相关阅读|广告|评论|点赞|分享|举报|备案|二维码|关注公众号/iu,
  ]);
  return Math.max(
    0,
    normalized.length + paragraphs.length * 80 + cjkOrWords * 2 + punctuation * 8 - noise * 120,
  );
}

function extractHtmlElementsByTag(html: string, tag: string): readonly string[] {
  const results: string[] = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "giu");
  for (const match of html.matchAll(pattern)) {
    results.push(match[0]);
  }
  return results;
}

function extractHtmlElementsByAttribute(
  html: string,
  attribute: string,
  pattern: RegExp,
): readonly string[] {
  const results: string[] = [];
  const tagPattern = new RegExp(
    `<([A-Za-z][A-Za-z0-9:-]*)\\b[^>]*\\b${attribute}\\s*=\\s*(["'])([\\s\\S]*?)\\2[^>]*>[\\s\\S]*?<\\/\\1>`,
    "giu",
  );
  for (const match of html.matchAll(tagPattern)) {
    const value = match[3] ?? "";
    if (pattern.test(value)) {
      results.push(match[0]);
    }
  }
  return results;
}

function removeHtmlElementsByTag(html: string, tag: string): string {
  return html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "giu"), " ");
}

function removeHtmlElementsByAttribute(html: string, attribute: string, pattern: RegExp): string {
  const tagPattern = new RegExp(
    `<([A-Za-z][A-Za-z0-9:-]*)\\b[^>]*\\b${attribute}\\s*=\\s*(["'])([\\s\\S]*?)\\2[^>]*>[\\s\\S]*?<\\/\\1>`,
    "giu",
  );
  return html.replace(tagPattern, (match, _tag: string, _quote: string, value: string) =>
    pattern.test(value) ? " " : match,
  );
}

function parseDuckDuckGoHtml(html: string): readonly ConversationRuntimeWebSearchResult[] {
  const results: ConversationRuntimeWebSearchResult[] = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    const className = extractHtmlAttribute(attributes, "class");
    if (!/(?:result__a|result__title|result-title|result-link)/iu.test(className ?? "")) {
      continue;
    }
    const href = extractHtmlAttribute(attributes, "href");
    if (href === undefined) {
      continue;
    }
    const url = resolveSearchResultUrl(decodeHtmlEntity(href));
    if (url === null || !isSafeHttpUrl(url) || isSearchAdOrTrackingUrl(url)) {
      continue;
    }
    const title = normalizeWhitespace((match[2] ?? "").replace(/<[^>]+>/gu, " "));
    if (title.length === 0 || isLikelySearchAdTitle(title)) {
      continue;
    }
    results.push({
      title,
      url,
      source: "duckduckgo",
    });
  }
  return sanitizeWebSearchResults(results);
}

function parseDuckDuckGoRenderedText(text: string): readonly ConversationRuntimeWebSearchResult[] {
  const lines = text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => normalizeWhitespace(line.replace(/^#{1,6}\s*/u, "")))
    .filter((line) => line.length > 0);
  const results: ConversationRuntimeWebSearchResult[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const url = resolveDuckDuckGoRenderedResultUrl(lines[index] ?? "");
    if (url === null || !isSafeHttpUrl(url) || isSearchAdOrTrackingUrl(url)) {
      continue;
    }
    const host = new URL(url).hostname;
    if (/duckduckgo\.com$/iu.test(host)) {
      continue;
    }
    const title = normalizeDuckDuckGoRenderedTitle(lines[index - 1] ?? "");
    if (title === undefined || isLikelySearchAdTitle(title)) {
      continue;
    }
    const snippet = readDuckDuckGoRenderedSnippet(lines, index + 1);
    if (snippet !== undefined && isLikelySearchAdSnippet(snippet)) {
      continue;
    }
    results.push({
      title,
      url,
      source: "duckduckgo",
      ...optionalSnippet(snippet),
    });
  }
  return sanitizeWebSearchResults(results);
}

function normalizeDuckDuckGoRenderedTitle(line: string): string | undefined {
  const title = normalizeWhitespace(line.replace(/\bAD\b\s*$/iu, ""));
  if (
    title.length < 4 ||
    title.length > 180 ||
    isLikelyRenderedSearchUrlLine(title) ||
    /^(?:DuckDuckGo|Search|All Regions|Any Time|Next|Feedback|首页)$/iu.test(title)
  ) {
    return undefined;
  }
  return title;
}

function readDuckDuckGoRenderedSnippet(
  lines: readonly string[],
  startIndex: number,
): string | undefined {
  const snippets: string[] = [];
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 3); index += 1) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";
    if (isLikelyRenderedSearchUrlLine(line) || isLikelyRenderedSearchUrlLine(nextLine)) {
      break;
    }
    snippets.push(line);
  }
  const snippet = normalizeWhitespace(snippets.join(" "));
  return snippet.length === 0 ? undefined : snippet.slice(0, 280);
}

function isLikelyRenderedSearchUrlLine(line: string): boolean {
  return resolveDuckDuckGoRenderedResultUrl(line) !== null;
}

function resolveDuckDuckGoRenderedResultUrl(line: string): string | null {
  const explicit = /https?:\/\/[^\s)）]+/iu.exec(line)?.[0];
  if (explicit !== undefined) {
    return sanitizeRenderedSearchUrl(explicit);
  }
  const bare = /(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s，。；;]*)?/iu.exec(line)?.[0];
  if (bare === undefined || bare.includes("@")) {
    return null;
  }
  return sanitizeRenderedSearchUrl(`https://${bare}`);
}

function sanitizeRenderedSearchUrl(value: string): string | null {
  try {
    const url = new URL(value.replace(/[.,，。；;]+$/u, ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (isSearchAdOrTrackingUrl(url.href)) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function extractHtmlAttribute(attributes: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`, "iu");
  const match = pattern.exec(attributes);
  const value = match?.[2];
  return value === undefined ? undefined : decodeHtmlEntity(value);
}

function extractStructuredMediaFromHtml(
  html: string,
  baseUrl: string,
): readonly Readonly<Record<string, unknown>>[] {
  const media: Readonly<Record<string, unknown>>[] = [];
  const mediaElementPattern = /<(img|video|audio|source)\b([^>]*)>(?:([\s\S]*?)<\/\1>)?/giu;
  for (const match of html.matchAll(mediaElementPattern)) {
    const tag = (match[1] ?? "").toLocaleLowerCase();
    const attributes = match[2] ?? "";
    const body = match[3] ?? "";
    const src =
      extractHtmlAttribute(attributes, "src") ??
      extractHtmlAttribute(attributes, "data-src") ??
      extractHtmlAttribute(attributes, "data-original") ??
      extractFirstSrcsetUrl(extractHtmlAttribute(attributes, "srcset"));
    const resolvedSrc = resolveHtmlMediaUrl(src, baseUrl);
    const poster = resolveHtmlMediaUrl(extractHtmlAttribute(attributes, "poster"), baseUrl);
    if (resolvedSrc !== undefined) {
      media.push({
        type:
          tag === "img" ? "image" : tag === "source" ? readHtmlSourceMediaType(attributes) : tag,
        url: resolvedSrc,
        origin: `html.${tag}`,
        ...(poster === undefined ? {} : { poster }),
        ...readHtmlMediaDimensions(attributes),
        ...readHtmlMediaMimeType(attributes),
      });
    }
    if ((tag === "video" || tag === "audio") && poster !== undefined) {
      media.push({
        type: "poster",
        url: poster,
        origin: `html.${tag}.poster`,
      });
    }
    for (const nested of extractStructuredMediaFromHtml(body, baseUrl)) {
      media.push(nested);
    }
  }
  return dedupeStructuredHtmlMedia(media);
}

function dedupeStructuredHtmlMedia(
  media: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  const deduped = new Map<string, Readonly<Record<string, unknown>>>();
  for (const item of media) {
    const url = typeof item.url === "string" ? item.url : undefined;
    if (url === undefined || url.length === 0) {
      continue;
    }
    if (!deduped.has(url)) {
      deduped.set(url, item);
    }
  }
  return [...deduped.values()];
}

function readHtmlSourceMediaType(attributes: string): string {
  const type = extractHtmlAttribute(attributes, "type")?.toLocaleLowerCase() ?? "";
  if (type.startsWith("audio/")) {
    return "audio";
  }
  if (type.startsWith("image/")) {
    return "image";
  }
  return "video";
}

function readHtmlMediaMimeType(attributes: string): Readonly<Record<string, unknown>> {
  const mimeType = extractHtmlAttribute(attributes, "type");
  return mimeType === undefined ? {} : { mimeType };
}

function readHtmlMediaDimensions(attributes: string): Readonly<Record<string, unknown>> {
  const width = parseHtmlPositiveNumber(extractHtmlAttribute(attributes, "width"));
  const height = parseHtmlPositiveNumber(extractHtmlAttribute(attributes, "height"));
  return {
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

function parseHtmlPositiveNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function extractFirstSrcsetUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const first = value
    .split(",")
    .map((item) => item.trim().split(/\s+/u)[0] ?? "")
    .find((item) => item.length > 0);
  return first;
}

function resolveHtmlMediaUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const trimmed = decodeHtmlEntity(value.trim());
  if (trimmed.startsWith("blob:")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function looksLikeSogouVerificationPage(html: string, responseUrl: string): boolean {
  const normalized = normalizeWhitespace(html).toLowerCase();
  return (
    /\/antispider\//iu.test(responseUrl) ||
    /请输入验证码|验证码|访问过于频繁|用户您好.*访问/i.test(normalized)
  );
}

function parseSogouWeixinHtml(html: string): readonly ConversationRuntimeWebSearchResult[] {
  const results: ConversationRuntimeWebSearchResult[] = [];
  const itemPattern = /<li\b[^>]*>([\s\S]*?)<\/li>/giu;
  for (const item of html.matchAll(itemPattern)) {
    const block = item[1] ?? "";
    if (!/mp\.weixin\.qq\.com|weixin\.sogou\.com|\/link\?/iu.test(block)) {
      continue;
    }
    const link = extractSogouWeixinTitleAnchor(block) ?? extractFirstAnchor(block);
    if (link === null) {
      continue;
    }
    const resolvedUrl = resolveSogouWeixinResultUrl(link.href);
    if (resolvedUrl === null || !isSafeHttpUrl(resolvedUrl)) {
      continue;
    }
    const title = normalizeWhitespace(stripHtml(link.label));
    if (title.length === 0) {
      continue;
    }
    results.push({
      title,
      url: resolvedUrl,
      source: "sogou-weixin",
      ...optionalSnippet(extractSogouWeixinSnippet(block)),
    });
  }
  if (results.length > 0) {
    return dedupeSearchResults(results);
  }

  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = decodeHtmlEntity(match[1] ?? "");
    if (!/mp\.weixin\.qq\.com|\/link\?/iu.test(rawHref)) {
      continue;
    }
    const resolvedUrl = resolveSogouWeixinResultUrl(rawHref);
    if (resolvedUrl === null || !isSafeHttpUrl(resolvedUrl)) {
      continue;
    }
    const title = normalizeWhitespace(stripHtml(match[2] ?? ""));
    if (title.length === 0) {
      continue;
    }
    results.push({
      title,
      url: resolvedUrl,
      source: "sogou-weixin",
    });
  }
  return dedupeSearchResults(results);
}

function extractSogouWeixinTitleAnchor(
  block: string,
): { readonly href: string; readonly label: string } | null {
  const headingMatch = /<h3\b[^>]*>([\s\S]*?)<\/h3>/iu.exec(block);
  const source = headingMatch?.[1] ?? block;
  for (const match of source.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)) {
    const href = decodeHtmlEntity(match[1] ?? "");
    if (!/mp\.weixin\.qq\.com|\/link\?/iu.test(href)) {
      continue;
    }
    const label = match[2] ?? "";
    if (normalizeWhitespace(stripHtml(label)).length === 0) {
      continue;
    }
    return { href, label };
  }
  return null;
}

function extractFirstAnchor(
  block: string,
): { readonly href: string; readonly label: string } | null {
  const match = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/iu.exec(block);
  if (match === null) {
    return null;
  }
  return {
    href: decodeHtmlEntity(match[1] ?? ""),
    label: match[2] ?? "",
  };
}

function resolveSogouWeixinResultUrl(rawHref: string): string | null {
  if (rawHref.length === 0) {
    return null;
  }
  try {
    const url = rawHref.startsWith("//")
      ? new URL(`https:${rawHref}`)
      : new URL(rawHref, "https://weixin.sogou.com");
    for (const key of ["url", "target", "redirect"]) {
      const value = url.searchParams.get(key);
      if (value !== null && isSafeHttpUrl(value)) {
        return decodeHtmlEntity(value);
      }
    }
    return decodeHtmlEntity(url.href);
  } catch {
    return null;
  }
}

function extractSogouWeixinSnippet(block: string): string | undefined {
  const match =
    /<p\b[^>]*class=["'][^"']*(?:txt-info|summary)[^"']*["'][^>]*>([\s\S]*?)<\/p>/iu.exec(block) ??
    /<p\b[^>]*>([\s\S]*?)<\/p>/iu.exec(block);
  if (match === null) {
    return undefined;
  }
  const snippet = normalizeWhitespace(stripHtml(match[1] ?? ""));
  return snippet.length === 0 ? undefined : snippet;
}

function optionalSnippet(snippet: string | undefined): { readonly snippet?: string } {
  return snippet === undefined ? {} : { snippet };
}

function stripHtml(value: string): string {
  return value
    .replace(/<!--\s*(?:red_beg|red_end)\s*-->/giu, "")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<\/?em\b[^>]*>/giu, "")
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<[^>]+>/gu, " ");
}

function resolveSearchResultUrl(rawHref: string): string | null {
  if (rawHref.length === 0) {
    return null;
  }
  try {
    const url = rawHref.startsWith("//")
      ? new URL(`https:${rawHref}`)
      : new URL(rawHref, "https://html.duckduckgo.com");
    const redirected = url.searchParams.get("uddg") ?? url.searchParams.get("u3");
    const resolved = redirected ?? url.href;
    return isSearchAdOrTrackingUrl(resolved) ? null : resolved;
  } catch {
    return null;
  }
}

type WebExtractUrlSafety =
  | {
      readonly ok: true;
      readonly parsed: URL;
    }
  | {
      readonly ok: false;
      readonly status: "blocked" | "error";
      readonly summary: string;
      readonly failure: string;
      readonly securityGate: string;
      readonly nextActions: readonly string[];
    };

function validatePublicWebExtractUrl(value: string): WebExtractUrlSafety {
  if (urlLooksSecretBearing(value)) {
    return {
      ok: false,
      status: "blocked",
      summary: "web_extract blocked this URL because it appears to contain a secret.",
      failure: "blocked secret-bearing URL: secrets must not be sent through web_extract",
      securityGate: "blocked-secret-bearing-url",
      nextActions: ["remove credentials or tokens from the URL before retrying"],
    };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      ok: false,
      status: "error",
      summary: "web_extract only accepts public http/https URLs.",
      failure: "invalid or unsupported URL",
      securityGate: "invalid-url",
      nextActions: ["retry with a public http/https URL"],
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      status: "error",
      summary: "web_extract only accepts public http/https URLs.",
      failure: "invalid or unsupported URL",
      securityGate: "invalid-url",
      nextActions: ["retry with a public http/https URL"],
    };
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return {
      ok: false,
      status: "blocked",
      summary: "web_extract blocked this URL because it contains credentials.",
      failure: "blocked secret-bearing URL: username/password credentials are not allowed",
      securityGate: "blocked-secret-bearing-url",
      nextActions: ["remove credentials from the URL before retrying"],
    };
  }

  if (hostnameLooksPrivateOrInternal(url.hostname)) {
    return {
      ok: false,
      status: "blocked",
      summary: "web_extract blocked this URL because it targets a private or internal network.",
      failure: "blocked private or internal network URL",
      securityGate: "blocked-private-or-internal-url",
      nextActions: ["use browser tools for explicit local pages, or retry with a public URL"],
    };
  }

  return { ok: true, parsed: url };
}

function urlLooksSecretBearing(value: string): boolean {
  const decoded = decodeUrlForInspection(value);
  for (const candidate of new Set([value, decoded])) {
    if (/(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{6,}/u.test(candidate)) {
      return true;
    }
    if (/bearer\s+[A-Za-z0-9._~+/=-]{8,}/iu.test(candidate)) {
      return true;
    }
    try {
      const url = new URL(candidate);
      for (const [rawKey, rawValue] of url.searchParams.entries()) {
        if (secretSearchParamLooksSensitive(rawKey, rawValue)) {
          return true;
        }
      }
    } catch {
      if (
        /(?:^|[?&#;])(?:api[_-]?key|client[_-]?secret|password|passwd|authorization)=/iu.test(
          candidate,
        ) ||
        /(?:^|[?&#;])(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret)=.{8,}/iu.test(
          candidate,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function secretSearchParamLooksSensitive(rawKey: string, rawValue: string): boolean {
  const key = rawKey.trim().toLocaleLowerCase().replace(/[-_]/gu, "");
  const value = rawValue.trim();
  if (value.length === 0) {
    return false;
  }
  if (
    key === "apikey" ||
    key === "clientsecret" ||
    key === "password" ||
    key === "passwd" ||
    key === "authorization"
  ) {
    return true;
  }
  if (
    key === "token" ||
    key === "accesstoken" ||
    key === "refreshtoken" ||
    key === "idtoken" ||
    key === "secret"
  ) {
    return value.length >= 8 || /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{6,}/u.test(value);
  }
  return false;
}

function decodeUrlForInspection(value: string): string {
  let current = value;
  for (let attempts = 0; attempts < 3; attempts += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        return decoded;
      }
      current = decoded;
    } catch {
      return current;
    }
  }
  return current;
}

function hostnameLooksPrivateOrInternal(hostname: string): boolean {
  const normalized = normalizeUrlHostname(hostname);
  if (normalized.length === 0) {
    return true;
  }
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan")
  ) {
    return true;
  }
  if (!normalized.includes(".") && !normalized.includes(":")) {
    return true;
  }
  const ipv4 = parseStrictIpv4(normalized);
  if (ipv4 !== null) {
    return ipv4LooksPrivateOrSpecial(ipv4);
  }
  if (looksLikeUnsupportedIpv4Literal(normalized)) {
    return true;
  }
  if (normalized.includes(":")) {
    return ipv6LooksPrivateOrSpecial(normalized);
  }
  const embeddedIpv4 = extractEmbeddedIpv4(normalized);
  return embeddedIpv4 !== null && ipv4LooksPrivateOrSpecial(embeddedIpv4);
}

function normalizeUrlHostname(hostname: string): string {
  return hostname.trim().toLocaleLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
}

function parseStrictIpv4(value: string): readonly [number, number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const parsed = parts.map((part) =>
    /^(?:0|[1-9][0-9]{0,2})$/u.test(part) ? Number.parseInt(part, 10) : Number.NaN,
  );
  if (parsed.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parsed as [number, number, number, number];
}

function ipv4LooksPrivateOrSpecial(ip: readonly [number, number, number, number]): boolean {
  const [a, b] = ip;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function looksLikeUnsupportedIpv4Literal(value: string): boolean {
  if (/^0x[0-9a-f]+$/iu.test(value) || /^[0-9]+$/u.test(value)) {
    return true;
  }
  const parts = value.split(".");
  return parts.length > 1 && parts.length < 4 && parts.every((part) => /^[0-9]+$/u.test(part));
}

function ipv6LooksPrivateOrSpecial(value: string): boolean {
  const normalized = value.toLocaleLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized.endsWith(":0:0:0:0:0:0:1")) {
    return true;
  }
  const embeddedIpv4 = extractEmbeddedIpv4(normalized);
  if (embeddedIpv4 !== null && ipv4LooksPrivateOrSpecial(embeddedIpv4)) {
    return true;
  }
  const firstSegment = normalized.split(":").find((segment) => segment.length > 0);
  if (firstSegment === undefined || !/^[0-9a-f]{1,4}$/iu.test(firstSegment)) {
    return true;
  }
  const first = Number.parseInt(firstSegment, 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}

function extractEmbeddedIpv4(value: string): readonly [number, number, number, number] | null {
  const match = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(value);
  return match?.[1] === undefined ? null : parseStrictIpv4(match[1]);
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function dedupeSearchResults(
  results: readonly ConversationRuntimeWebSearchResult[],
): readonly ConversationRuntimeWebSearchResult[] {
  const byUrl = new Map<string, ConversationRuntimeWebSearchResult>();
  for (const result of results) {
    if (!byUrl.has(result.url)) {
      byUrl.set(result.url, result);
    }
  }
  return [...byUrl.values()];
}

function decodeHtmlEntity(value: string): string {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">");
}

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntity(value).replace(/\s+/gu, " ").trim();
}
