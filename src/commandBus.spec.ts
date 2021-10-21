import 'reflect-metadata'

import { interval, mergeMap, Observable, take } from 'rxjs'

import { createCommandBus } from './factories/createCommandBus.factory'
import { ICommandHandler } from './interfaces/commandHandler.interface'
import { ObservableCommand, UndoableObservableCommand, UndoableResult } from './models/command'
import { CommandContext } from './models/context'

describe('CommandBus', () => {
    const { bus, CommandHandler } = createCommandBus()

    class TheCommand extends ObservableCommand<number> {
        constructor(public s: string) {
            super()
        }
    }

    class TheCommand2 extends ObservableCommand<number> {
        constructor(public s: string) {
            super()
        }
    }

    class TheUndoableCommand2 extends UndoableObservableCommand<number> {
        constructor(public s: string) {
            super()
        }
    }

    @CommandHandler(TheCommand)
    class TheCommandHandler implements ICommandHandler<TheCommand> {
        public execute(command: TheCommand, { execute }: CommandContext): Observable<number> {
            return execute(new TheCommand2(command.s))
        }
    }

    @CommandHandler(TheCommand2)
    class TheCommandHandler2 implements ICommandHandler<TheCommand2> {
        public execute(): Observable<number> {
            return interval(2000)
        }
    }

    const a = []

    @CommandHandler(TheUndoableCommand2)
    class TheUndoableCommandHandler2 implements ICommandHandler<TheUndoableCommand2> {
        public execute(c: TheUndoableCommand2): UndoableResult<Observable<number>> {
            a.push(c.s)
            return {
                value: interval(2000),
                async undo(): Promise<any> {
                    a.pop()
                },
            }
        }
    }

    test('test', (done) => {
        expect(1).toBe(1)

        bus.registerHandlerInstance(new TheCommandHandler())
        bus.registerHandlerInstance(new TheCommandHandler2())
        bus.registerHandlerInstance(new TheUndoableCommandHandler2())

        const c = bus.execute(new TheUndoableCommand2('s'))
        c.value
            .pipe(
                take(1),
                mergeMap(() => {
                    expect(a).toHaveLength(1)
                    return c.undo()
                }),
            )
            .subscribe(() => {
                expect(a).toHaveLength(0)
                done()
            })
    })
})
