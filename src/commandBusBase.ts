import { Options } from '.'
import { COMMAND_BUS_OPTIONS, COMMAND_HANDLER_METADATA, ResultType } from './constants'
import { InvalidQueueHandlerException } from './exceptions/invalidCommandHandler.exception'
import { getConstructor } from './helpers'
import { CommandHandler, Handler, HandlerType } from './interfaces'
import { IType } from './interfaces/type.interface'
import { Command } from './models/command'
import { CommandBusOptions } from './models/commandBusOptions'

export abstract class CommandBusBase<C extends Command = Command, O extends Options = Options> {
    protected handlers = new Map<string, [Handler<C, O>, CommandHandler<C, O>?]>()
    protected name: string
    protected injectionResolver: CommandBusOptions<C, O>['injectionResolver']
    public onExecute?: CommandBusOptions<C, O>['onExecute']

    constructor(options?: CommandBusOptions<C, O>) {
        const parsedOptions = new CommandBusOptions<C, O>(
            options || Reflect.getMetadata(COMMAND_BUS_OPTIONS, this.constructor) || {},
        )
        this.onExecute = parsedOptions.onExecute
        this.injectionResolver = parsedOptions.injectionResolver
        this.name = parsedOptions.name
    }

    // HANDLERS

    /**
     * Uses the Handler class instance, keeping a reference to call later it's execute function
     */
    public bindHandler<T extends C = C>(
        handler: (command: T) => T[ResultType],
        commandName: string,
        handlerInstance?: CommandHandler<T, O>,
    ): void {
        this.handlers.set(commandName, [handler, handlerInstance])
    }

    /**
     * Registers the handler so it's intance execute function can
     * be called later by the bus
     */
    public registerHandlerInstance(handlerInstance: CommandHandler<C, O>): void {
        const handler = handlerInstance

        const constructor = getConstructor(handler)

        const target: { data: IType<C>; bus: CommandBusBase } = Reflect.getMetadata(
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
    public registerHandlersInstances(handlersInstances: Array<CommandHandler<C, O>> = []): void {
        handlersInstances.forEach((handler) => this.registerHandlerInstance(handler))
    }

    /**
     * Registers the handler so it's intance execute function can
     * be called later by the bus
     */
    public registerHandlerFactory(
        Handler: HandlerType<C, O>,
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
        handlersFactories: Array<HandlerType<C, O>> = [],
        injectionResolver?: CommandBusOptions['injectionResolver'],
    ): void {
        handlersFactories.forEach((handlerFactory) =>
            this.registerHandlerFactory(handlerFactory, injectionResolver),
        )
    }

    /**
     * Registers all the handlers
     */
    public registerFunctionHandler<T extends C = C>(
        command: IType<T>,
        handler: Handler<T, O>,
    ): void {
        this.bindHandler(handler, command.name)
    }

    /**
     * Register function handlers
     */
    public registerFunctionHandlers(handlers: Array<[IType<C>, Handler<C, O>]>): void {
        for (const [command, handler] of handlers) {
            this.registerFunctionHandler(command, handler)
        }
    }

    // EXECUTION

    /**
     * Executes the command
     */
    public execute<T extends C = C>(command: T, options?: O): T[ResultType] {
        const commandName = command.constructor.name

        return this.executeByName(commandName, command, options).toPromise()
    }

    /**
     * Executes the registered handler for the command name
     */
    protected executeByName<T extends C = C, Opts extends O = O>(
        commandName: string,
        data: T,
        options?: Opts,
    ): C[ResultType] {
        const [handler, handlerInstance] = this.handlers.get(commandName)

        if (!handler) {
            throw new InvalidQueueHandlerException(commandName)
        }

        if (this.onExecute) {
            return this.onExecute(data, handler, options, handlerInstance)
        }

        return handler(data, options)
    }
}
