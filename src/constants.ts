export const COMMAND_HANDLER_METADATA = Symbol()
export const COMMAND_BUS_OPTIONS = Symbol()

export const RESULT_TYPE = Symbol('command result type')
export type ResultType = typeof RESULT_TYPE

export const HANDLERS = {
    BEFORE_REGISTER_HANDLER: Symbol(),
    AFTER_REGISTER_HANDLER: Symbol(),

    BEFORE_EXECUTE_HANDLER: Symbol(),
    AFTER_EXECUTE_HANDLER: Symbol(),

    INTERCEPT_EXECUTION_HANDLER: Symbol(),

    ON_INVALID_QUEUE_HANDLER_EXCEPTION: Symbol(),
}

Object.freeze(HANDLERS)
