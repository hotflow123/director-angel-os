import { type TaskState, decodeTaskEvent, isTaskEventType } from "@hotflow/contracts";

export function decodeTaskTodoWriteState(payload: unknown): TaskState | undefined {
  const event = decodeTaskEvent({
    eventType: "tasks.todo_write",
    payload,
  });
  if (!event || event.eventType !== "tasks.todo_write") {
    return undefined;
  }
  return event.payload;
}

export function normalizeTaskEventPayloadForSessionWrite(
  eventType: string,
  payload: unknown,
): unknown {
  if (!isTaskEventType(eventType)) {
    return payload;
  }
  return decodeTaskEvent({ eventType, payload })?.payload ?? payload;
}

export function normalizeTaskEventPayloadForTasksCoreRead(
  eventType: string,
  payload: unknown,
  _createdAtMs: number,
): unknown {
  if (!isTaskEventType(eventType)) {
    return payload;
  }
  return decodeTaskEvent({ eventType, payload })?.payload ?? payload;
}
