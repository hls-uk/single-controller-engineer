export const commandNames = [
  "inspect",
  "acquire-controller",
  "next",
  "plan-wave",
  "prepare-wave",
  "dispatch-request",
  "record-dispatch",
  "collect-candidate",
  "qualify",
  "review-prepare",
  "review-record",
  "publish",
  "integrate",
  "gate-wave",
  "resume",
  "status",
  "release-controller",
  "feedback",
] as const;

export type CommandName = (typeof commandNames)[number];

export const feedbackActions = [
  "prepare",
  "preview",
  "submit",
  "flush",
] as const;

export type FeedbackAction = (typeof feedbackActions)[number];

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface CommandOptions {
  readonly expectedRevision?: number;
  readonly idempotencyKey?: string;
  readonly json: boolean;
  readonly request?: JsonObject;
}

export interface CommandRequest {
  readonly command: CommandName;
  readonly feedbackAction?: FeedbackAction;
  readonly options: CommandOptions;
  readonly schema: "sce.command.request";
  readonly version: 1;
}

export type CommandRunnerResult =
  | {
      readonly result: JsonObject;
      readonly status: "ok";
    }
  | {
      readonly message?: string;
      readonly status: "unavailable";
    };

/**
 * The only execution seam used by the CLI. Protocol and adapter work can
 * replace this implementation without changing parsing or presentation.
 */
export type CommandRunner = (
  request: CommandRequest,
) => CommandRunnerResult | Promise<CommandRunnerResult>;

export const unavailableCommandRunner: CommandRunner = (request) => ({
  message: `The ${request.command} command is not wired in Phase 1.`,
  status: "unavailable",
});

export function isCommandName(value: string): value is CommandName {
  return (commandNames as readonly string[]).includes(value);
}

export function isFeedbackAction(value: string): value is FeedbackAction {
  return (feedbackActions as readonly string[]).includes(value);
}
