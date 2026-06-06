export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

export class InvalidSessionIdError extends SessionError {
  constructor(sessionId: string) {
    super(`Invalid session id: "${sessionId}"`);
    this.name = "InvalidSessionIdError";
  }
}

export class SessionNotFoundError extends SessionError {
  constructor(sessionId: string) {
    super(`Session not found: "${sessionId}"`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionArchivedError extends SessionError {
  constructor(sessionId: string) {
    super(`Session "${sessionId}" is archived and cannot be mutated`);
    this.name = "SessionArchivedError";
  }
}

export class SchemaVersionMismatchError extends SessionError {
  constructor(expected: string, actual: string, context: string) {
    super(`Schema version mismatch for ${context}: expected "${expected}" but got "${actual}"`);
    this.name = "SchemaVersionMismatchError";
  }
}

export class SessionRecoveryError extends SessionError {
  constructor(message: string) {
    super(message);
    this.name = "SessionRecoveryError";
  }
}
