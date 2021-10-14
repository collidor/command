import 'reflect-metadata'

import { interval, Observable, take } from 'rxjs'

import { createCommandBus } from './factories/createCommandBus.factory'
import { ICommandHandler } from './interfaces/commandHandler.interface'
import { ObservableCommand } from './models/command'
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

    test('test', (done) => {
        expect(1).toBe(1)

        bus.registerHandler(new TheCommandHandler())
        bus.registerHandler(new TheCommandHandler2())

        bus.execute(new TheCommand('s'))
            .pipe(take(1))
            .subscribe((n) => {
                console.log(n)
                done()
            })
    })
})
