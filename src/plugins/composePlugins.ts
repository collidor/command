import { Options } from '..'
import { ResultType } from '../constants'
import { ExecutionContext, OnExecute } from '../interfaces/onExecute.interface'
import { Plugin } from '../interfaces/plugin.interface'
import { Command } from '../models'

export function composePlugins<T extends Command, A extends Command<T>>(
    p1: Plugin<T, A>,
): OnExecute<T>
export function composePlugins<
    T extends Command,
    A extends Command<T[ResultType]>,
    B extends Command<A[ResultType]>,
>(p1: Plugin<T, A>, p2: Plugin<A, B>): OnExecute<T>
export function composePlugins<
    T extends Command,
    A extends Command<T[ResultType]>,
    B extends Command<A[ResultType]>,
    C extends Command<B[ResultType]>,
>(p1: Plugin<T, A>, p2: Plugin<A, B>, p3: Plugin<B, C>): OnExecute<T>
export function composePlugins<
    T extends Command,
    A extends Command<T[ResultType]>,
    B extends Command<A[ResultType]>,
    C extends Command<B[ResultType]>,
    D extends Command<C[ResultType]>,
>(p1: Plugin<T, A>, p2: Plugin<A, B>, p3: Plugin<B, C>, p4: Plugin<C, D>): OnExecute<T>
export function composePlugins<
    T extends Command,
    A extends Command<T[ResultType]>,
    B extends Command<A[ResultType]>,
    C extends Command<B[ResultType]>,
    D extends Command<C[ResultType]>,
    E extends Command<D[ResultType]>,
>(
    p1: Plugin<T, A>,
    p2: Plugin<A, B>,
    p3: Plugin<B, C>,
    p4: Plugin<C, D>,
    p5: Plugin<D, E>,
): OnExecute<T>
export function composePlugins(...plugins: Plugin[]): OnExecute {
    return ((data: Command, context: ExecutionContext<Command, Options>) => {
        if (!plugins.length) {
            return context.handler(data, context.options)
        }

        if (plugins.length === 1) {
            return plugins[0]()(data, context)
        }

        return context.handler(
            plugins.reduce<OnExecute>((acc, plugin) => {
                if (!acc) {
                    return plugin()
                }
                return plugin(acc)
            }, null)(data, context),
            context.options,
        )
    }) as OnExecute
}
