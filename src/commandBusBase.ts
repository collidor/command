import { Observable } from 'rxjs'
import { Options } from '.'

import { COMMAND_CONTEXT, COMMAND_HANDLER_METADATA, HANDLERS, ResultType } from './constants'
import { InvalidQueueHandlerException } from './exceptions/invalidCommandHandler.exception'
import { getConstructor, isFunction } from './helpers'
import { ICommandHandler } from './interfaces/commandHandler.interface'
import { IType } from './interfaces/type.interface'
import { CommandType, UndoableResult } from './models/command'
import { CommandContext } from './models/context'

export type HandlerType = IType<ICommandHandler>

export abstract class CommandBusBase<O extends Options = Options> {
    protected handlers = new Map<string, ICommandHandler>()

    constructor(public name: string, public plugins?: any) {}

    // HANDLERS

    /**
     * Uses the Handler class instance, keeping a reference to call later it's execute function
     */
    public bindHandler<T extends CommandType = CommandType>(
        handlerInstance: ICommandHandler<T>,
        commandName: string,
    ): void {
        this.handlers.set(commandName, handlerInstance)
    }

    /**
     * Registers the handler so it's intance execute function can
     * be called later by the bus
     */
    public registerHandlerInstance(handlerInstance: ICommandHandler): void {
        const handler =
            this.plugins?.getPlugins(HANDLERS.BEFORE_REGISTER_HANDLER)?.(handlerInstance) ||
            handlerInstance

        const constructor = getConstructor(handler)

        const target: { data: IType<CommandType>; bus: CommandBusBase } = Reflect.getMetadata(
            COMMAND_HANDLER_METADATA,
            getConstructor(handlerInstance),
        )

        if (!target) {
            throw new InvalidQueueHandlerException(constructor.name, this.name)
        }

        if (target.bus !== Object.getPrototypeOf(this).constructor) {
            return
        }

        this.bindHandler(handler, target.data.name)
        this.plugins?.getPlugins(HANDLERS.BEFORE_REGISTER_HANDLER)?.(handler, target.data.name)
    }

    /**
     * Registers all the handlers
     */
    public registerHandlersInstances(handlersInstances: ICommandHandler[] = []): void {
        handlersInstances.forEach((handler) => this.registerHandlerInstance(handler))
    }

    // EXECUTION

    /**
     * Executes the command
     */
    public execute<T extends CommandType = CommandType, ExecuteOptions extends O = O>(command: T, options?:  ExecuteOptions ): T[ResultType] {
        const constructor = getConstructor(command as any)

        const context:CommandContext = Reflect.getMetadata(COMMAND_CONTEXT, command) || new CommandContext<ExecuteOptions>()
        context.commands.add(command)

        context.execute = (<T2 extends CommandType = CommandType, OptionsContext extends ExecuteOptions = ExecuteOptions>(command2: T2, optionsContext?: OptionsContext): T2[ResultType] => {
            Reflect.defineMetadata(COMMAND_CONTEXT, context, command)
            return this.execute<T2, OptionsContext>(command2, optionsContext)
        }) as CommandContext<ExecuteOptions>['execute']

        Reflect.defineMetadata(COMMAND_CONTEXT, context, command)
        return this.executeByName<T>(constructor.name, command, options)
    }

    /**
     * Executes the registered handler for the command name
     */
    protected executeByName<T extends CommandType = CommandType>(
        commandName: string,
        data: T,
        options?: O
    ): T[ResultType] {

        const context = Reflect.getMetadata(COMMAND_CONTEXT, data)
        const handler: ICommandHandler = this.handlers.get(commandName)

        const d = this.plugins?.getPlugins(HANDLERS.BEFORE_EXECUTE_HANDLER)?.(data, commandName, handler, context, options) || data

        if (!handler) {
            const pluginErrorHook = this.plugins?.getPlugins(HANDLERS.BEFORE_EXECUTE_HANDLER)
            if(pluginErrorHook) {
                return pluginErrorHook(d, commandName, handler, options)
            } else {
                throw new InvalidQueueHandlerException(commandName)
            }
        }

        try {

            const result = (this.plugins?.getPlugins(HANDLERS.INTERCEPT_EXECUTION_HANDLER)?.(commandName, handler, options, handler.execute) || handler.execute)(d, context)

            this.plugins?.getPlugins(HANDLERS.AFTER_EXECUTE_HANDLER)?.(data, commandName, handler, context, options, result)
            if (isFunction((result as Observable<any>)?.subscribe)) {
                return result as Observable<any>
            } else if ((result as UndoableResult<any>).value) {
                if (
                    isFunction(
                        ((result as UndoableResult<any>).value as Observable<any>)?.subscribe,
                    )
                ) {
                    return result as T[ResultType]
                }
            }

            return Promise.resolve(result) as T[ResultType] extends Observable<infer O>
                ? Observable<O>
                : T[ResultType]
        } catch (err) {
            return Promise.reject(err) as T[ResultType] extends Observable<infer O>
                ? Observable<O>
                : T[ResultType]
        }
    }
}
