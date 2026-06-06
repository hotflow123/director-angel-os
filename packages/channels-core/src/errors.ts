import { ContractError } from "@hotflow/contracts";

export class InvalidChannelRoutingHintError extends ContractError {
  constructor(message: string, metadata?: Readonly<Record<string, unknown>>) {
    super({
      code: "VALIDATION_FAILURE",
      message,
      ...(metadata ? { metadata } : {}),
    });
    this.name = "InvalidChannelRoutingHintError";
  }
}
