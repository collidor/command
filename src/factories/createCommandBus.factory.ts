import { CommandBus } from '../commandBus'
import { CommandHandler } from '../decorators/commandHandler.decorator'
import { IType } from '../interfaces/type.interface'
import { CommandType } from '../models/comand'

export function createCommandBus(name = 'command'): {
    CommandHandler: (command: IType<CommandType>) => ClassDecorator
    bus: CommandBus
} {
    const bus = new CommandBus(name)

    const decorator = (command: IType<CommandType>): ClassDecorator => CommandHandler(bus, command)
    return { CommandHandler: decorator, bus }
}
