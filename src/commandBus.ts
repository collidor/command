import type { Injector, Type } from "@collidor/injector";
import type { Command, COMMAND_RETURN } from "./commandModel.ts";

export interface CommandBusContext {
  inject: Injector["inject"];
}

export type CommandHandler<
  TContext extends CommandBusContext = CommandBusContext,
  BaseCommand extends Command = Command,
> = <C extends BaseCommand = BaseCommand>(
  arg: C,
  context: TContext,
) => C[COMMAND_RETURN];

export type CommandInstance<
  TContext extends CommandBusContext = CommandBusContext,
  BaseCommand extends Command = Command,
> = { execute: CommandHandler<TContext, BaseCommand> };

export type CommandHandlerConstructor<
  TContext extends CommandBusContext = CommandBusContext,
> = Type<CommandInstance<TContext>>;

export class CommandBus<
  TContext extends CommandBusContext = CommandBusContext,
> {
  protected inject: Injector["inject"];
  protected context: TContext;

  public commandsHandlers: Map<
    string,
    CommandHandler<TContext>
  > = new Map();
  public commandHandlerConstructors: Map<
    string,
    CommandHandlerConstructor<TContext>
  > = new Map();

  constructor(
    inject: Injector["inject"],
    options?: { context?: TContext },
  ) {
    this.inject = inject;
    this.context = options?.context || ({ inject } as TContext);
  }

  public handler<
    C extends Command,
    This extends CommandInstance<TContext, C>,
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
    Q extends CommandHandler<TContext, C>,
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
          handlerConstructor,
        );

        if (handlerInstance?.execute) {
          handler = handlerInstance.execute.bind(handlerInstance);
        }
      }
    }

    if (!handler) {
      throw new Error(
        `Command handler for ${command.constructor.name} not found`,
      );
    }
    if (isVoid) {
      handler(command, this.context);
      return null;
    }
    return handler(command, this.context);
  }
}
