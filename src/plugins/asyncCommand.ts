import { setTimeout } from 'timers/promises'

import { Options } from '..'
import { ExecutionContext, OnExecute } from '../interfaces/onExecute.interface'
import { Plugin } from '../interfaces/plugin.interface'
import { Command } from '../models'

interface AsyncOptions {
    timeout?: number
}

declare module '..' {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Options extends AsyncOptions {}
}

export class AsyncCommand<T = any> extends Command<Promise<T>> {}

export const asyncCommand: Plugin<Command, AsyncCommand, Options, AsyncOptions> = (onExecute) => {
    return ((data: AsyncCommand, context: ExecutionContext<AsyncCommand, AsyncOptions>) => {
        let result = onExecute
            ? onExecute<AsyncCommand>(data, context)
            : context.handler(data, context.options)

        if (context.options.timeout) {
            result = Promise.race([
                result,
                setTimeout(context.options.timeout).then(() => {
                    throw new Error(
                        `AsyncCommand Timeout Error: timeout of ${context.options.timeout} reached for command ${context.name}`,
                    )
                }),
            ])
        }

        if (!result || !(result instanceof Promise)) {
            throw new Error('AsyncCommandHandler must return a promise')
        }
        return result
    }) as OnExecute
}
