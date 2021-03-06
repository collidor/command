import { Command, CommandBusBase, CommandBusOptions, CommandHandler } from '..'
import { COMMAND_BUS_OPTIONS, ResultType } from '../constants'
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
    [key in `${T}Handler`]: (
        command: IType<Command>,
        resolver?: boolean | CommandBusOptions['injectionResolver'],
    ) => ClassDecorator
} & {
    bind<T extends Command>(command: IType<T>, handler: (command: T) => T[ResultType]): void
} {
    const ret = {
        [name as `${T}`]: class extends CommandBusBase {},
    }
    Reflect.defineMetadata(COMMAND_BUS_OPTIONS, options, ret[name])
    const bus = new ret[name]()
    const decorator = (
        command: IType<Command>,
        resolver: boolean | CommandBusOptions['injectionResolver'],
    ) => CommandHandler(bus, command, resolver)

    return {
        [uncapitalize(name)]: bus,
        [`${name}Handler`]: decorator,
        bind: bus.registerFunctionHandler.bind(bus),
    } as any
}
