import { CommandBusBase } from '../commandBusBase'
import { CommandHandler } from '../decorators/commandHandler.decorator'
import { IType } from '../interfaces/type.interface'
import { CommandType } from '../models/command'

export type BusName<T extends string> = `${Capitalize<T>}Bus`

export function createCommandBus(name: `${Capitalize<string>}Bus` = 'CommandBus'): {
    CommandHandler: (command: IType<CommandType>) => ClassDecorator
    commandBus: CommandBusBase
} {
    const temp = {
        [name]: class extends CommandBusBase {
            constructor() {
                super(name)
            }
        },
    }

    const busInstance: CommandBusBase = new temp[name]()
    const decorator = (command: IType<CommandType>): ClassDecorator =>
        CommandHandler(temp[name], command)

    return { CommandHandler: decorator, commandBus: busInstance }
}

createCommandBus('aaBus')
