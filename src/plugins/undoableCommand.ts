import { Command, Options } from '..'
import { ExecutionContext, OnExecute } from '../interfaces/onExecute.interface'
import { Plugin } from '../interfaces/plugin.interface'

type UndoableResult<T = any, Q = void, Strict extends boolean = true> = Strict extends true
    ? { undo: () => Q; value: T; name?: string }
    : { undo?: () => Q; value: T; name?: string }

export class UndoableCommandController<Strict extends boolean = true> {
    public history: Array<UndoableResult<any, any, Strict>> = []

    constructor(public historySize = 10) {}

    public undoLast(): UndoableResult<any, any, Strict> {
        const result = this.history.pop()
        if (result) {
            result?.undo?.()
        }
        return result
    }

    public addEntry<T = any, Q = void, S extends Strict = Strict>(
        result: UndoableResult<T, Q, S>,
    ): void {
        if (!result.undo) this.history.push(result)
        if (this.history.length >= this.historySize) {
            this.history.shift()
        }
    }
}

interface UndoableOptions {
    controller?: boolean | UndoableCommandController
    /**
     * if set to true, all commands must return a undo function, if false,
     * the command will not be saved in the history
     */
    strict?: boolean
}

declare module '..' {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Options extends UndoableOptions {}
}

export class UndoableCommand<T = any, Q = void> extends Command<UndoableResult<T, Q>> {}

export const undoableCommand =
    <Strict extends boolean = true>(
        controller = new UndoableCommandController<Strict>(),
    ): Plugin<Command, UndoableCommand, Options, UndoableOptions> =>
    (onExecute?) => {
        return ((data: UndoableCommand, context: ExecutionContext<UndoableCommand, Options>) => {
            const result = onExecute
                ? onExecute(data, context)
                : context.handler(data, context.options)

            if (!result?.undo) {
                throw new Error('UndoableCommandHandler must return an undo function')
            }
            controller.addEntry({
                value: result.value,
                name: result.name,
                undo: result.undo,
            })
            return result
        }) as OnExecute
    }
