import { CommandBusBase, CommandBusOptions, CommandHandler, CommandType } from '..'
import { COMMAND_BUS_OPTIONS } from '../constants'
import { IType } from '../interfaces/type.interface'

function uncapitalize(str: string): string {
    return str.charAt(0).toLowerCase() + str.slice(1)
}

export function createCommandBus<T extends Capitalize<string>>(
    name: T,
    options?: CommandBusOptions,
): {
    [key in `${Uncapitalize<T>}`]: CommandBusBase
} & {
    decorator: (
        command: IType<CommandType>,
        resolver?: boolean | CommandBusOptions['injectionResolver'],
    ) => ClassDecorator
} {
    const ret = {
        [name as `${T}`]: class extends CommandBusBase<CommandBusOptions> {},
    }
    Reflect.defineMetadata(COMMAND_BUS_OPTIONS, options, ret[name])
    const bus = new ret[name]()
    const decorator = (
        command: IType<CommandType>,
        resolver: boolean | CommandBusOptions['injectionResolver'],
    ) => CommandHandler(bus, command, resolver)

    return {
        [uncapitalize(name)]: bus,
        decorator,
    } as any
}
