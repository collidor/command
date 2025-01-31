import type { Injector } from "@collidor/injector";
import type { Command, COMMAND_RETURN } from "./commandModel.ts";

export type CommandHandler<C extends Command = Command> = (
    arg: C,
) => C[COMMAND_RETURN];

export type CommandHandlerConstructor<C extends Command = Command> = Type<
    { execute: CommandHandler<C> }
>;

export class CommandBus<BaseComandHandler extends CommandHandler> {
    public commandsHandlers = new Map<
        string,
        CommandHandler<any>
    >();
    public commandHandlerConstructors = new Map<
        string,
        CommandHandlerConstructor<any>
    >();

    constructor(protected inject: Injector["inject"]) {}

    public handler<
        C extends Command,
        This extends BaseComandHandler,
        Args extends unknown[],
        HandlerArgs extends unknown[],
        Target extends new (...args: HandlerArgs) => This,
    >(
        command: new (...args: Args) => C,
    ): (
        target: Target,
        context?: ClassDecoratorContext<new (...args: HandlerArgs) => This>,
    ) => void {
        return (target: Type<unknown>) => {
            this.commandHandlerConstructors.set(command.name, target as any);
        };
    }

    public bind<
        C extends Command,
        Q extends CommandHandler<any>,
    >(
        command: Type<C>,
        handler: Q,
    ) {
        this.commandsHandlers.set(command.name, handler);
    }

    public execute<C extends Command>(
        command: C,
        isVoid = false,
    ): C[COMMAND_RETURN] {
        if (!command.constructor) {
            throw new Error("Command must have a constructor");
        }
        let handler = this.commandsHandlers.get(
            command.constructor.name,
        );
        if (handler === undefined) {
            const handlerConstructor = this.commandHandlerConstructors.get(
                command.constructor.name,
            );
            if (handlerConstructor) {
                const handlerInstance = this.inject(
                    handler,
                );

                handler = handlerInstance.execute.bind(handlerInstance);
            } else {
                throw new Error(
                    `Command handler for ${command.constructor.name} not found`,
                );
            }
        }

        if (handler) {
            if (isVoid) {
                handler(command);
                return null;
            }
            return handler(command);
        }
    }
}
