import { interval, Observable } from 'rxjs'

import { CommandBus } from './commandBus'
import { CommandHandler } from './decorators/commandHandler.decorator'
import { ICommandHandler } from './interfaces/commandHandler.interface'
import { ObservableCommand } from './models/comand'

const a = new CommandBus('command')

class TheCommand extends ObservableCommand<number> {
    constructor(public s: string) {
        super()
    }
}

@(CommandHandler(a)(TheCommand))
class TheCommandHandler implements ICommandHandler<TheCommand> {
    public execute(command: TheCommand): Observable<number> {
        console.log(command.s)

        return interval(2000)
    }
}

a.registerHandler(new TheCommandHandler())
// a.r
