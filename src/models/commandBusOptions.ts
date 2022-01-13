import { Options } from '..'
import { ResultType } from '../constants'
import { CommandHandler, Handler } from '../interfaces'
import { IType } from '../interfaces/type.interface'
import { Command } from '.'

export class CommandBusOptions<C extends Command = Command, O extends Options = Options> {
    public name?: string
    public injectionResolver: <T = CommandHandler<C, O>>(constructor: IType<T>) => T = (
        constructor,
    ) => new constructor()

    public onExecute?<T extends C = C>(
        data: C,
        handler: Handler<T, O>,
        options?: O,
        instance?: CommandHandler<T, O>,
    ): T[ResultType]

    constructor(options?: CommandBusOptions) {
        if (options) {
            Object.assign(this, options)
        }
    }
}
