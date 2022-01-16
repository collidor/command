import { CommandBusBase } from '../commandBusBase'
import { COMMAND_HANDLER_METADATA } from '../constants'
import { IType } from '../interfaces/type.interface'
import { Command } from '../models/command'
import { CommandBusOptions } from '../models/commandBusOptions'

export const CommandHandler = (
    bus: CommandBusBase,
    command: IType<Command>,
    resolver?: boolean | CommandBusOptions['injectionResolver'],
): ClassDecorator => {
    return (target: any): void => {
        Reflect.defineMetadata(COMMAND_HANDLER_METADATA, { data: command, bus }, target)

        if (resolver !== false) {
            bus.registerHandlerFactory(
                target,
                typeof resolver === 'function' ? resolver : undefined,
            )
        }
    }
}
