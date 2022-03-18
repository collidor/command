import { Options as BaseOptions } from '..'
import { ResultType } from '../constants'
import { Command as BaseCommand } from '../models'
import { OnExecute } from './onExecute.interface'

export interface Plugin<
    Command extends BaseCommand = BaseCommand,
    PluginCommmand extends BaseCommand<Command[ResultType]> = BaseCommand<Command[ResultType]>,
    Options extends BaseOptions = BaseOptions,
    PluginOptions extends BaseOptions = BaseOptions,
> {
    (onExecute?: OnExecute<Command, Options>): OnExecute<PluginCommmand, PluginOptions>
}
