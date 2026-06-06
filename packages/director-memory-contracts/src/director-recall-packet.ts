import { isDirectorRecallHit } from "./director-recall-hit.js";
import { isDirectorRecallQuery } from "./director-recall-query.js";
import {
  isArrayOf,
  isArrayOfStrings,
  isBoolean,
  isObject,
  isOneOf,
  isOptional,
  isString,
} from "./guards.js";

export const DIRECTOR_RECALL_PACKET_SCHEMA_VERSION = "director.memory.recall-packet.v1" as const;

export const DIRECTOR_RECALL_PACKET_STATUSES = ["ok", "miss", "disabled", "degraded"] as const;

export type DirectorRecallPacketStatus = (typeof DIRECTOR_RECALL_PACKET_STATUSES)[number];

export interface DirectorRecallPacket {
  readonly schemaVersion: typeof DIRECTOR_RECALL_PACKET_SCHEMA_VERSION;
  readonly queryId: string;
  readonly status: DirectorRecallPacketStatus;
  readonly recordedAt: string;
  readonly notes: readonly string[];
  readonly hits: readonly import("./director-recall-hit.js").DirectorRecallHit[];
  readonly query: import("./director-recall-query.js").DirectorRecallQuery;
  readonly truncated?: boolean;
}

export function isDirectorRecallPacketStatus(value: unknown): value is DirectorRecallPacketStatus {
  return isOneOf(value, DIRECTOR_RECALL_PACKET_STATUSES);
}

export function isDirectorRecallPacket(value: unknown): value is DirectorRecallPacket {
  return (
    isObject(value) &&
    value.schemaVersion === DIRECTOR_RECALL_PACKET_SCHEMA_VERSION &&
    isString(value.queryId) &&
    isDirectorRecallPacketStatus(value.status) &&
    isString(value.recordedAt) &&
    isArrayOfStrings(value.notes) &&
    isArrayOf(value.hits, isDirectorRecallHit) &&
    isDirectorRecallQuery(value.query) &&
    isOptional(value.truncated, isBoolean)
  );
}
