import { mkdirSync } from "node:fs";
import { join } from "node:path";

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

export function getConversationRuntimeDataDir(override?: string): string {
  const configured =
    override?.trim() ||
    process.env.HOTFLOW_DATA_DIR?.trim() ||
    process.env.CONVERSATION_RUNTIME_DATA_DIR?.trim() ||
    process.env.OPENHARNESS_DATA_DIR?.trim();
  return configured && configured.length > 0 ? configured : join(process.cwd(), ".hotflow");
}

export function getConversationRuntimeStoreDir(baseDir?: string): string {
  return ensureDir(join(getConversationRuntimeDataDir(baseDir), "conversation-runtime"));
}

export function getKnowledgeRootDir(baseDir?: string): string {
  return ensureDir(join(getConversationRuntimeStoreDir(baseDir), "knowledge"));
}

export function getKnowledgeItemsDir(baseDir?: string): string {
  return ensureDir(join(getKnowledgeRootDir(baseDir), "items"));
}

export function getKnowledgeEventsPath(baseDir?: string): string {
  return join(getKnowledgeRootDir(baseDir), "events.jsonl");
}

export function getKnowledgeRegistryPath(baseDir?: string): string {
  return join(getKnowledgeRootDir(baseDir), "registry.json");
}

export function getKnowledgeItemDir(itemId: string, baseDir?: string): string {
  return ensureDir(join(getKnowledgeItemsDir(baseDir), itemId));
}

export function getKnowledgeItemMetaPath(itemId: string, baseDir?: string): string {
  return join(getKnowledgeItemDir(itemId, baseDir), "meta.json");
}

export function getKnowledgeRevisionsDir(itemId: string, baseDir?: string): string {
  return ensureDir(join(getKnowledgeItemDir(itemId, baseDir), "revisions"));
}

export function getKnowledgeRevisionPath(
  itemId: string,
  revisionId: string,
  baseDir?: string,
): string {
  return join(getKnowledgeRevisionsDir(itemId, baseDir), `${revisionId}.json`);
}

export function getKnowledgePublishedDir(itemId: string, baseDir?: string): string {
  return ensureDir(join(getKnowledgeItemDir(itemId, baseDir), "published"));
}

export function getKnowledgePublishedCurrentPath(itemId: string, baseDir?: string): string {
  return join(getKnowledgePublishedDir(itemId, baseDir), "current.json");
}

export function getKnowledgePublishedHistoryDir(itemId: string, baseDir?: string): string {
  return ensureDir(join(getKnowledgePublishedDir(itemId, baseDir), "history"));
}

export function getKnowledgePublishedHistoryPath(
  itemId: string,
  revisionId: string,
  baseDir?: string,
): string {
  return join(getKnowledgePublishedHistoryDir(itemId, baseDir), `${revisionId}.json`);
}
