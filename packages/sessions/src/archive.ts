import { SessionNotFoundError } from "./errors.js";
import type { SessionStorage } from "./storage.js";
import type { ArchiveSessionInput, SessionRecord } from "./types.js";

export class SessionArchive {
  constructor(private readonly storage: SessionStorage) {}

  archive(session: SessionRecord, input: ArchiveSessionInput = {}): SessionRecord {
    if (session.status === "archived") {
      return session;
    }
    const archived = this.storage.setSessionArchived(
      session.sessionId,
      input.reason ?? null,
      this.storage.now(),
    );
    if (!archived) {
      throw new SessionNotFoundError(session.sessionId);
    }
    return archived;
  }
}
