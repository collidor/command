import { Command, CommandBusOptions, Options } from '..'
import { CommandHandler, Handler } from '../interfaces'

type UndoableResult<T = any, Q = void> = {
    value: T
    name?: string
    undo: () => Q
}

export class UndoableCommandController {
    public history: UndoableResult[] = []

    constructor(public historySize = 10, public onExecute?: CommandBusOptions['onExecute']) {}

    public undoLast(): UndoableResult {
        const result = this.history.pop()
        if (result) {
            result?.undo()
        }
        return result
    }

    public addEntry(result: UndoableResult): void {
        this.history.push(result)
        if (this.history.length >= this.historySize) {
            this.history.shift()
        }
    }
}

interface UndoableOptions {
    controller?: boolean | UndoableCommandController
}

declare module '..' {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Options extends UndoableOptions {}
}

export class UndoableCommand<T = any, Q = void> extends Command<UndoableResult<T, Q>> {}

export function undoableCommand(
    controller = new UndoableCommandController(),
): CommandBusOptions<UndoableCommand, Options>['onExecute'] {
    return ((
        data: UndoableCommand,
        handler: Handler<UndoableCommand, Options>,
        options?: Options,
        instance?: CommandHandler<UndoableCommand, Options>,
    ) => {
        const result = controller?.onExecute
            ? controller.onExecute(data, handler, options, instance)
            : handler(data, options)

        if (!result?.undo) {
            throw new Error('UndoableCommandHandler must return an undo function')
        }
        controller.addEntry({
            value: result.value,
            name: result.name,
            undo: result.undo,
        })
        return result
    }) as CommandBusOptions<UndoableCommand, Options>['onExecute']
}
