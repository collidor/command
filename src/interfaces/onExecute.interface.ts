import { Options as BaseOptions } from '..'
import { ResultType } from '../constants'
import { Command } from '../models'
import { CommandHandler, Handler } from './commandHandler.interface'

export interface ExecutionContext<
    T extends Command = Command,
    O extends BaseOptions = BaseOptions,
> {
    handler: Handler<T, O>
    name: string
    options?: O
    instance?: CommandHandler<T, O>
}

export interface OnExecute<C extends Command = Command, Options extends BaseOptions = BaseOptions> {
    <T extends C = C, O extends Options = Options>(
        data: C,
        context: ExecutionContext<T, O>,
    ): T[ResultType]
}
