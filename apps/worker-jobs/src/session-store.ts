import type { SessionStore } from "@hotflow/sessions";

export function resolveWorkerJobSessionStore(
  provided: SessionStore | undefined,
  runtime: { readonly sessionStore: SessionStore } | null,
): SessionStore {
  const sessionStore = provided ?? runtime?.sessionStore;
  if (sessionStore === undefined) {
    throw new Error("Worker jobs session store is unavailable.");
  }
  return sessionStore;
}
