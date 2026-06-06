import type { ChatRole, MemoryEntry, MemoryLike } from "./contracts.js";

export class FakeMemory implements MemoryLike {
  private readonly entries: MemoryEntry[] = [];

  append(entry: Omit<MemoryEntry, "timestamp"> & { timestamp?: number }): MemoryEntry {
    const normalized: MemoryEntry = {
      role: entry.role,
      content: entry.content,
      timestamp: entry.timestamp ?? Date.now(),
      ...(entry.name !== undefined ? { name: entry.name } : {}),
      ...(entry.metadata !== undefined ? { metadata: { ...entry.metadata } } : {}),
    };
    this.entries.push(normalized);
    return normalized;
  }

  list(): readonly MemoryEntry[] {
    return [...this.entries];
  }

  reset(): void {
    this.entries.length = 0;
  }

  byRole(role: ChatRole): readonly MemoryEntry[] {
    return this.entries.filter((entry) => entry.role === role);
  }
}
