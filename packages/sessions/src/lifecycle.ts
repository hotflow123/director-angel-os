import { SessionArchivedError, SessionNotFoundError } from "./errors.js";
import { assertSessionId, createSessionId } from "./keys.js";
import type { SessionStorage } from "./storage.js";
import type { CreateSessionInput, JsonObject, SessionRecord } from "./types.js";
import { resolveSchemaVersion } from "./version.js";

export class SessionLifecycle {
  constructor(
    private readonly storage: SessionStorage,
    private readonly defaultSchemaVersion: string,
  ) {}

  create(input: CreateSessionInput = {}): SessionRecord {
    const sessionId = input.sessionId ?? createSessionId();
    assertSessionId(sessionId);
    const metadata = (input.metadata ?? {}) as JsonObject;
    const schemaVersion = resolveSchemaVersion(input.schemaVersion ?? this.defaultSchemaVersion);
    return this.storage.createSession({
      sessionId,
      metadata,
      schemaVersion,
    });
  }

  get(sessionId: string): SessionRecord | null {
    assertSessionId(sessionId);
    return this.storage.getSession(sessionId);
  }

  require(sessionId: string): SessionRecord {
    const session = this.get(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    return session;
  }

  requireActive(sessionId: string): SessionRecord {
    const session = this.require(sessionId);
    if (session.status === "archived") {
      throw new SessionArchivedError(sessionId);
    }
    return session;
  }

  updateMetadata(sessionId: string, metadata: JsonObject): SessionRecord {
    this.requireActive(sessionId);
    const updated = this.storage.updateSessionMetadata(sessionId, metadata, this.storage.now());
    if (!updated) {
      throw new SessionNotFoundError(sessionId);
    }
    return updated;
  }
}
