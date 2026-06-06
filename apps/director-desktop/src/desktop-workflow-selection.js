export function resolveWorkflowIdForCommandSelection({ workflows, activeWorkflowId, commandId }) {
  const activeWorkflow = workflows.find((workflow) => workflow.id === activeWorkflowId);
  if (activeWorkflow?.commandIds.includes(commandId)) {
    return activeWorkflow.id;
  }
  return (
    workflows.find((workflow) => workflow.commandIds.includes(commandId))?.id ?? activeWorkflowId
  );
}
