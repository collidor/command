import { Observable } from 'rxjs'

import { COMMAND_BUS_OPTIONS, COMMAND_HANDLER_METADATA, ResultType } from './constants'
import { InvalidQueueHandlerException } from './exceptions/invalidCommandHandler.exception'
import { getConstructor, isFunction } from './helpers'
import { ICommandHandler } from './interfaces/commandHandler.interface'
import { IType } from './interfaces/type.interface'
import { CommandType, UndoableResult } from './models/command'
import { CommandBusOptions } from './models/commandBusOptions'

export type HandlerType = IType<ICommandHandler>

export abstract class CommandBusBase {
    protected handlers = new Map<
        string,
        [(command: CommandType) => CommandType[ResultType], ICommandHandler]
    >()
    protected name: string
    protected injectionResolver: CommandBusOptions['injectionResolver']

    constructor(options?: CommandBusOptions) {
        const parsedOptions = new CommandBusOptions(
            options || Reflect.getMetadata(COMMAND_BUS_OPTIONS, this.constructor) || {},
        )
        this.injectionResolver = parsedOptions.injectionResolver
        this.name = parsedOptions.name
    }

    // HANDLERS

    /**
     * Uses the Handler class instance, keeping a reference to call later it's execute function
     */
    public bindHandler<T extends CommandType = CommandType>(
        handler: (command: T) => T[ResultType],
        commandName: string,
        handlerInstance?: ICommandHandler,
    ): void {
        this.handlers.set(commandName, [handler, handlerInstance])
    }

    /**
     * Registers the handler so it's intance execute function can
     * be called later by the bus
     */
    public registerHandlerInstance(handlerInstance: ICommandHandler): void {
        const handler = handlerInstance

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

        this.bindHandler(handler.execute, target.data.name, handler)
    }

    /**
     * Registers all the handlers
     */
    public registerHandlersInstances(handlersInstances: ICommandHandler[] = []): void {
        handlersInstances.forEach((handler) => this.registerHandlerInstance(handler))
    }

    /**
     * Registers the handler so it's intance execute function can
     * be called later by the bus
     */
    public registerHandlerFactory(
        Handler: IType<ICommandHandler>,
        injectionResolver?: CommandBusOptions['injectionResolver'],
    ): void {
        const resolver = injectionResolver || this.injectionResolver
        if (!resolver) {
            throw new Error('injectionResolver is required')
        }
        return this.registerHandlerInstance(injectionResolver(Handler))
    }

    /**
     * Registers all the handlers
     */
    public registerHandlersFactories(
        handlersFactories: Array<IType<ICommandHandler>> = [],
        injectionResolver?: CommandBusOptions['injectionResolver'],
    ): void {
        handlersFactories.forEach((handlerFactory) =>
            this.registerHandlerFactory(handlerFactory, injectionResolver),
        )
    }

    /**
     * Registers all the handlers
     */
    public registerFunctionHandler<T extends CommandType>(
        command: IType<T>,
        handler: (command: T) => T[ResultType],
    ): void {
        this.bindHandler(handler, command.name)
    }

    // EXECUTION

    /**
     * Executes the command
     */
    public execute<T extends CommandType = CommandType>(command: T): T[ResultType] {
        const constructor = getConstructor(command as any)
        return this.executeByName<T>(constructor.name, command)
    }

    /**
     * Executes the registered handler for the command name
     */
    protected executeByName<T extends CommandType = CommandType>(
        commandName: string,
        data: T,
    ): T[ResultType] {
        const handler: (command: T) => T[ResultType] = this.handlers.get(commandName)[0]

        if (!handler) {
            throw new InvalidQueueHandlerException(commandName)
        }

        try {
            const result = handler(data)

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
