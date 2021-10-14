import { CommandBus } from '../commandBus'
import { COMMAND_HANDLER_METADATA } from '../constants'
import { IType } from '../interfaces/type.interface'
import { CommandType } from '../models/comand'

export const CommandHandler = (bus: CommandBus, command: IType<CommandType>): ClassDecorator => {
    return (target: any): void => {
        Reflect.defineMetadata(COMMAND_HANDLER_METADATA, { data: command, bus }, target)
    }
}
