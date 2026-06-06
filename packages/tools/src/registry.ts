import type {
  ToolAvailability,
  ToolDefinition,
  ToolSchemaDescriptor,
  ToolsetDefinition,
} from "./contracts.js";
import { DEFAULT_TOOLSET_NAME, resolveToolsetName } from "./toolset.js";

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();

  register<TArgs, TOutput>(definition: ToolDefinition<TArgs, TOutput>): void {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Tool already registered: ${definition.name}`);
    }

    // The registry stores heterogeneous tool signatures behind a shared runtime surface.
    this.definitions.set(definition.name, definition as unknown as ToolDefinition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  list(toolset?: string): ToolDefinition[] {
    const definitions = [...this.definitions.values()];
    if (!toolset) {
      return definitions;
    }

    return definitions.filter((definition) => resolveToolsetName(definition) === toolset);
  }

  getAvailability(
    name: string,
    env: NodeJS.ProcessEnv = process.env,
  ): ToolAvailability | undefined {
    const definition = this.get(name);
    if (!definition) {
      return undefined;
    }

    return evaluateToolAvailability(definition, env);
  }

  listAvailable(
    toolsetOrEnv: string | NodeJS.ProcessEnv = process.env,
    env: NodeJS.ProcessEnv = process.env,
  ): ToolDefinition[] {
    const { toolset, resolvedEnv } = normalizeListInput(toolsetOrEnv, env);
    return this.list(toolset).filter(
      (definition) => evaluateToolAvailability(definition, resolvedEnv).available,
    );
  }

  listToolsets(): ToolsetDefinition[] {
    const grouped = new Map<
      string,
      {
        description?: string;
        enabledByDefault?: boolean;
        platform?: readonly string[];
        tools: string[];
      }
    >();

    for (const definition of this.list()) {
      const name = resolveToolsetName(definition);
      const current = grouped.get(name) ?? {
        tools: [],
      };

      current.tools.push(definition.name);
      if (current.description === undefined && definition.toolsetDescription !== undefined) {
        current.description = definition.toolsetDescription;
      }
      if (
        current.enabledByDefault === undefined &&
        definition.toolsetEnabledByDefault !== undefined
      ) {
        current.enabledByDefault = definition.toolsetEnabledByDefault;
      }
      if (current.platform === undefined && definition.toolsetPlatforms !== undefined) {
        current.platform = definition.toolsetPlatforms;
      }
      grouped.set(name, current);
    }

    return [...grouped.entries()]
      .map(([name, entry]) => ({
        name,
        description: entry.description ?? defaultToolsetDescription(name),
        tools: entry.tools.sort(),
        enabledByDefault: entry.enabledByDefault ?? name === DEFAULT_TOOLSET_NAME,
        ...(entry.platform === undefined ? {} : { platform: entry.platform }),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getSchemas(
    toolsetOrEnv: string | NodeJS.ProcessEnv = process.env,
    env: NodeJS.ProcessEnv = process.env,
  ): ToolSchemaDescriptor[] {
    const { toolset, resolvedEnv } = normalizeListInput(toolsetOrEnv, env);
    return this.listAvailable(toolset ?? resolvedEnv, resolvedEnv)
      .flatMap((definition) => {
        if (!definition.schema) {
          return [];
        }

        return [
          {
            name: definition.name,
            description: definition.description,
            toolset: resolveToolsetName(definition),
            readOnly: definition.readOnly,
            inputSchema: definition.schema,
          } satisfies ToolSchemaDescriptor,
        ];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}

function normalizeListInput(
  toolsetOrEnv: string | NodeJS.ProcessEnv,
  env: NodeJS.ProcessEnv,
): {
  toolset?: string;
  resolvedEnv: NodeJS.ProcessEnv;
} {
  return typeof toolsetOrEnv === "string"
    ? {
        toolset: toolsetOrEnv,
        resolvedEnv: env,
      }
    : {
        resolvedEnv: toolsetOrEnv,
      };
}

function defaultToolsetDescription(name: string): string {
  return name === DEFAULT_TOOLSET_NAME
    ? "Default toolset."
    : `Registered tools for the "${name}" toolset.`;
}

function evaluateToolAvailability(
  definition: ToolDefinition,
  env: NodeJS.ProcessEnv,
): ToolAvailability {
  const missingEnvVars = (definition.requiresEnv ?? []).filter(
    (name) => !hasPresentEnvValue(env[name]),
  );
  if (missingEnvVars.length > 0) {
    return {
      available: false,
      reason: "missing_required_env",
      message: `Tool "${definition.name}" is unavailable because required environment variables are missing: ${missingEnvVars.join(", ")}.`,
      missingEnvVars,
    };
  }

  if (!definition.checkFn) {
    return { available: true };
  }

  try {
    if (definition.checkFn()) {
      return { available: true };
    }

    return {
      available: false,
      reason: "check_unavailable",
      message: `Tool "${definition.name}" is unavailable because its availability check returned false.`,
    };
  } catch (error) {
    return {
      available: false,
      reason: "check_error",
      message: `Tool "${definition.name}" availability check failed: ${normalizeAvailabilityError(error)}`,
      error: normalizeAvailabilityError(error),
    };
  }
}

function hasPresentEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

function normalizeAvailabilityError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
