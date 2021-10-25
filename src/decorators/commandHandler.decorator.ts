import { CommandBusBase } from '../commandBusBase'
import { COMMAND_HANDLER_METADATA } from '../constants'
import { IType } from '../interfaces/type.interface'
import { CommandType } from '../models/command'

export const CommandHandler = (
    bus: IType<CommandBusBase>,
    command: IType<CommandType>,
): ClassDecorator => {
    return (target: any): void => {
        Reflect.defineMetadata(COMMAND_HANDLER_METADATA, { data: command, bus }, target)
    }
}
