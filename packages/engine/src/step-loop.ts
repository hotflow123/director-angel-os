export type StepLoopStopReason = "strategy-stop" | "max-steps";

export interface StepLoopIteration<TState> {
  readonly stepIndex: number;
  readonly maxSteps: number;
  readonly state: TState;
}

export interface StepLoopIterationResult<TState> {
  readonly state: TState;
  readonly continueLoop: boolean;
  readonly effect?: string;
}

export interface StepLoopStrategy<TState> {
  runStep(
    iteration: StepLoopIteration<TState>,
  ): Promise<StepLoopIterationResult<TState>> | StepLoopIterationResult<TState>;
}

export interface StepLoopStepEvent<TState> {
  readonly stepIndex: number;
  readonly result: StepLoopIterationResult<TState>;
}

export interface StepLoopHooks<TState> {
  readonly onStepCompleted?: (event: StepLoopStepEvent<TState>) => Promise<void> | void;
}

export interface StepLoopRunInput<TState> {
  readonly initialState: TState;
  readonly maxSteps: number;
  readonly startStepIndex?: number;
}

export interface StepLoopRunResult<TState> {
  readonly state: TState;
  readonly completedSteps: number;
  readonly stopReason: StepLoopStopReason;
}

export class StepLoop<TState> {
  public constructor(
    private readonly strategy: StepLoopStrategy<TState>,
    private readonly hooks: StepLoopHooks<TState> = {},
  ) {}

  public async run(input: StepLoopRunInput<TState>): Promise<StepLoopRunResult<TState>> {
    let state = input.initialState;
    const maxSteps = Math.max(0, input.maxSteps);
    const startStepIndex = Math.max(0, input.startStepIndex ?? 0);
    let completedSteps = 0;

    for (let stepIndex = startStepIndex; stepIndex < maxSteps; stepIndex += 1) {
      const result = await this.strategy.runStep({
        stepIndex,
        maxSteps,
        state,
      });
      state = result.state;
      completedSteps += 1;
      await this.hooks.onStepCompleted?.({
        stepIndex,
        result,
      });

      if (!result.continueLoop) {
        return {
          state,
          completedSteps,
          stopReason: "strategy-stop",
        };
      }
    }

    return {
      state,
      completedSteps,
      stopReason: "max-steps",
    };
  }
}
