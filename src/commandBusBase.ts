import {
    filter,
    from,
    map,
    mergeMap,
    Observable,
    of,
    OperatorFunction,
    Subject,
    Subscription,
    take,
    tap,
} from 'rxjs'

import { COMMAND_BUS_OPTIONS, COMMAND_HANDLER_METADATA, ResultType } from './constants'
import { InvalidQueueHandlerException } from './exceptions/invalidCommandHandler.exception'
import { getConstructor, isFunction } from './helpers'
import { ICommandHandler } from './interfaces/commandHandler.interface'
import { IType } from './interfaces/type.interface'
import { CommandType, UndoableHandlerResult } from './models/command'
import { CommandBusOptions } from './models/commandBusOptions'

export type HandlerType = IType<ICommandHandler>

export abstract class CommandBusBase {
    protected handlers = new Map<
        string,
        [(command: CommandType) => CommandType[ResultType], ICommandHandler]
    >()
    protected name: string
    protected injectionResolver: CommandBusOptions['injectionResolver']

    private _afterExecute = new Set<OperatorFunction<CommandType[ResultType], any>>()

    public queue$ = new Subject<[CommandType, symbol]>()
    public results$ = new Subject<[CommandType[ResultType], symbol]>()
    public subscription = new Subscription()

    constructor(options?: CommandBusOptions) {
        const parsedOptions = new CommandBusOptions(
            options || Reflect.getMetadata(COMMAND_BUS_OPTIONS, this.constructor) || {},
        )
        this.injectionResolver = parsedOptions.injectionResolver
        this.name = parsedOptions.name

        this.subscription.add(
            this.queue$
                .pipe(
                    mergeMap(([command, id]) => {
                        const constructor = getConstructor(command as any)
                        return this.executeByName(constructor.name, command).pipe(
                            map((command) => {
                                if (this._afterExecute.size) {
                                    const obs = of(command)
                                    // eslint-disable-next-line prefer-spread
                                    return obs.pipe.apply(obs, this._afterExecute.values())
                                }
                                return of(command)
                            }),
                            tap((result: CommandType[ResultType]) =>
                                this.results$.next([result, id]),
                            ),
                        )
                    }),
                )
                .subscribe(),
        )
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

    public afterExecute(...operators: Array<OperatorFunction<CommandType[ResultType], any>>) {
        for (const operator of operators) {
            this._afterExecute.add(operator)
        }

        return () => {
            for (const operator of operators) {
                this._afterExecute.delete(operator)
            }
        }
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
        const id = Symbol()
        const result$ = this.results$.pipe(
            filter(([, resultId]) => resultId === id),
            take(1),
            mergeMap(([result]) => result),
        )

        this.queue$.next([command, id])
        return result$
    }

    /**
     * Executes the registered handler for the command name
     */
    protected executeByName<T extends CommandType = CommandType>(
        commandName: string,
        data: T,
    ): Observable<any> {
        const handler: (
            command: T,
        ) => T[ResultType] extends Observable<infer M>
            ? M | Promise<M> | Observable<M>
            : T[ResultType] = this.handlers.get(commandName)[0] as any

        if (!handler) {
            throw new InvalidQueueHandlerException(commandName)
        }

        try {
            const result = handler(data)

            if (!result) {
                return of(result) as Observable<any>
            }

            if (isFunction((result as Observable<any>)?.subscribe)) {
                return result as Observable<any>
            } else if (
                (result as UndoableHandlerResult<any>).value &&
                isFunction((result as any).undo)
            ) {
                const r: any = (result as any).value
                if (isFunction((r.value as Observable<any>)?.subscribe)) {
                    return r.value.pipe(map((v) => [v, r.undo]))
                }
                return from(Promise.resolve(r.value).then((v) => [v, r.undo]))
            }

            return from(Promise.resolve(result)) as Observable<any>
        } catch (err) {
            return from(Promise.reject(err)) as Observable<any>
        }
    }

    public async closeQueue() {
        this.queue$.complete()
        this.subscription.unsubscribe()
    }
}
