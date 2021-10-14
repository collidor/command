import { Observable } from 'rxjs'

import { COMMAND_CONTEXT, COMMAND_HANDLER_METADATA, ResultType } from './constants'
import { InvalidQueueHandlerException } from './exceptions/invalidCommandHandler.exception'
import { getConstructor, isFunction } from './helpers'
import { ICommandHandler } from './interfaces/commandHandler.interface'
import { IType } from './interfaces/type.interface'
import { CommandType } from './models/command'
import { CommandContext } from './models/context'

export type HandlerType = IType<ICommandHandler>

export class CommandBus {
    protected handlers = new Map<string, ICommandHandler>()

    constructor(public name: string = 'command') {}

    // HANDLERS

    /**
     * Uses the Handler class instance, keeping a referenc to call later it's execute function
     */
    protected bind<T extends CommandType = CommandType>(
        handlerInstance: ICommandHandler<T>,
        commandName: string,
    ): void {
        this.handlers.set(commandName, handlerInstance)
    }

    /**
     * Registers the handler so it's intance execute function can
     * be called later by the bus
     */
    public registerHandler(handler: ICommandHandler): void {
        const constructor = getConstructor(handler)

        const target: { data: IType<CommandType>; bus: CommandBus } = Reflect.getMetadata(
            COMMAND_HANDLER_METADATA,
            getConstructor(handler),
        )

        if (!target) {
            throw new InvalidQueueHandlerException(constructor.name, this.name)
        }

        this.bind(handler, target.data.name)
    }

    /**
     * Registers all the handlers
     */
    public registerHandlers(handlers: ICommandHandler[] = []): void {
        handlers.forEach((handler) => this.registerHandler(handler))
    }

    // EXECUTION

    /**
     * Executes the command
     */
    public execute<T extends CommandType = CommandType>(command: T): T[ResultType] {
        const constructor = getConstructor(command as any)

        const context = command[COMMAND_CONTEXT] || new CommandContext()
        context.commands.add(command)

        context.execute = <T2 extends CommandType = CommandType>(command2: T2): T2[ResultType] => {
            command2[COMMAND_CONTEXT] = context
            return this.execute(command2)
        }

        command[COMMAND_CONTEXT] = context
        return this.executeByName<T>(constructor.name, command)
    }

    /**
     * Executes the registered handler for the command name
     */
    protected executeByName<T extends CommandType = CommandType>(
        commandName: string,
        data: T,
    ): T[ResultType] extends Observable<infer O> ? Observable<O> : T[ResultType] {
        const handler: ICommandHandler = this.handlers.get(commandName)

        if (!handler) {
            throw new InvalidQueueHandlerException(commandName)
        }

        try {
            const result = handler.execute(data, data[COMMAND_CONTEXT])

            if (isFunction((result as Observable<any>)?.subscribe)) {
                return result as Observable<any>
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
