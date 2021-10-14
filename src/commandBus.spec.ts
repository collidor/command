import 'reflect-metadata'

import { interval, Observable } from 'rxjs'

import { createCommandBus } from './factories/createCommandBus.factory'
import { ICommandHandler } from './interfaces/commandHandler.interface'
import { ObservableCommand } from './models/comand'

describe('CommandBus', () => {
    const { bus, CommandHandler } = createCommandBus()

    class TheCommand extends ObservableCommand<number> {
        constructor(public s: string) {
            super()
        }
    }

    @CommandHandler(TheCommand)
    class TheCommandHandler implements ICommandHandler<TheCommand> {
        public execute(command: TheCommand): Observable<number> {
            console.log(command.s)

            return interval(2000)
        }
    }

    bus.registerHandler(new TheCommandHandler())

    test('test', () => {
        expect(1).toBe(1)
    })
})
