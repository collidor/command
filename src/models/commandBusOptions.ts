import { Options as BaseOptions } from '..'
import { CommandHandler } from '../interfaces'
import { OnExecute } from '../interfaces/onExecute.interface'
import { IType } from '../interfaces/type.interface'
import { Command } from '.'

export class CommandBusOptions<
    C extends Command = Command,
    Options extends BaseOptions = BaseOptions,
> {
    public name?: string
    public injectionResolver: <T = CommandHandler<C, Options>>(constructor: IType<T>) => T = (
        constructor,
    ) => new constructor()

    public onExecute?: OnExecute<C, Options>

    constructor(options?: Partial<CommandBusOptions>) {
        if (options) {
            Object.assign(this, options)
        }
    }
}
