export const COMMAND_HANDLER_METADATA = Symbol()

export const RESULT_TYPE = Symbol('command result type')
export type ResultType = typeof RESULT_TYPE

export const COMMAND_CONTEXT = Symbol('command context type')
export type CommandContextType = typeof COMMAND_CONTEXT
