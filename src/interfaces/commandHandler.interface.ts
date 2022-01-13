import { Options } from '..'
import { ResultType } from '../constants'
import { Command } from '../models/command'
import { IType } from './type.interface'

export type Handler<C extends Command = Command, O extends Options = Options> = (
    command: C,
    options?: O,
) => C[ResultType]

export interface CommandHandler<C extends Command = Command, O extends Options = Options> {
    execute: Handler<C, O>
}

export type HandlerType<C extends Command = Command, O extends Options = Options> = IType<
    CommandHandler<C, O>
>
