// commandBus.ts
import type { Injector, Type } from "@collidor/injector";
import type { Command, COMMAND_RETURN } from "./commandModel.ts";

export interface CommandBusContext {
  inject: Injector["inject"];
}

export type CommandHandler<
  TContext extends CommandBusContext = CommandBusContext,
  BaseCommand extends Command = Command,
  TPlugin extends
    | SyncPlugin<TContext>
    | AsyncPlugin<TContext>
    | StreamPlugin<TContext> = SyncPlugin<TContext>,
> = (
  arg: BaseCommand,
  context: TContext,
) => PluginReturnType<TContext, TPlugin, BaseCommand[COMMAND_RETURN]>;

export type CommandInstance<
  TContext extends CommandBusContext = CommandBusContext,
  BaseCommand extends Command = Command,
  TPlugin extends
    | SyncPlugin<TContext>
    | AsyncPlugin<TContext>
    | StreamPlugin<TContext> = SyncPlugin<TContext>,
> = { execute: CommandHandler<TContext, BaseCommand, TPlugin> };

export type CommandHandlerConstructor<
  TContext extends CommandBusContext = CommandBusContext,
  BaseCommand extends Command = Command,
  TPlugin extends
    | SyncPlugin<TContext>
    | AsyncPlugin<TContext>
    | StreamPlugin<TContext> = SyncPlugin<TContext>,
> = Type<CommandInstance<TContext, BaseCommand, TPlugin>>;

// Define Plugin types and return type transformation
type PluginHandler<
  C extends Command,
  TContext extends CommandBusContext = CommandBusContext,
  R = C[COMMAND_RETURN],
> = (
  command: C,
  handler: CommandHandler<CommandBusContext, C>,
  context: TContext,
) => R;

export abstract class SyncPlugin<
  TContext extends CommandBusContext = CommandBusContext,
> {
  abstract wrapHandler: PluginHandler<Command, TContext>;
}

export abstract class AsyncPlugin<
  TContext extends CommandBusContext = CommandBusContext,
> {
  abstract wrapHandler: PluginHandler<
    Command,
    TContext,
    Promise<Command[COMMAND_RETURN]>
  >;
}

export abstract class StreamPlugin<
  TContext extends CommandBusContext = CommandBusContext,
> {
  abstract wrapHandler: PluginHandler<
    Command,
    TContext,
    AsyncIterable<Command[COMMAND_RETURN]>
  >;
}

type CommandBusPlugin<TContext extends CommandBusContext = CommandBusContext> =
  | SyncPlugin<TContext>
  | AsyncPlugin<TContext>
  | StreamPlugin<TContext>;

type PluginReturnType<
  TContext extends CommandBusContext,
  TPlugin extends CommandBusPlugin<TContext>,
  R,
> = TPlugin extends AsyncPlugin ? Promise<R>
  : TPlugin extends StreamPlugin ? AsyncIterable<R>
  : R;

export class CommandBus<
  TContext extends CommandBusContext = CommandBusContext,
  TPlugin extends CommandBusPlugin<TContext> = SyncPlugin<TContext>,
> {
  protected inject: Injector["inject"];
  protected context: TContext;
  protected plugin?: TPlugin;

  public commandsHandlers: Map<string, CommandHandler<TContext>> = new Map();
  public commandHandlerConstructors: Map<
    string,
    CommandHandlerConstructor<TContext>
  > = new Map();

  constructor(
    inject: Injector["inject"],
    options?: { context?: TContext; plugin?: TPlugin },
  ) {
    this.inject = inject;
    this.context = options?.context || ({ inject } as TContext);
    this.plugin = options?.plugin;
  }

  public handler<
    C extends Command,
    This extends { execute: CommandHandler<TContext, C, TPlugin> },
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
    Q extends CommandHandler<TContext, C, TPlugin>,
  >(
    command: Type<C>,
    handler: Q,
  ) {
    this.commandsHandlers.set(command.name, handler as any);
  }

  public execute<C extends Command>(
    command: C,
    options?: { isVoid?: boolean; context?: TContext },
  ): PluginReturnType<TContext, TPlugin, C[COMMAND_RETURN]> {
    if (command.constructor.name === "Object") {
      throw new Error("command must be a Command class instance");
    }
    let handler = this.commandsHandlers.get(command.constructor.name);

    if (handler === undefined) {
      const handlerConstructor = this.commandHandlerConstructors.get(
        command.constructor.name,
      );

      if (handlerConstructor) {
        const handlerInstance = this.inject(handlerConstructor);

        if (handlerInstance?.execute) {
          handler = handlerInstance.execute.bind(handlerInstance);
        }
      }
    }

    if (this.plugin) {
      return (this.plugin!).wrapHandler(
        command,
        handler as any,
        (options?.context as TContext) || this.context,
      ) as PluginReturnType<TContext, TPlugin, C[COMMAND_RETURN]>;
    }

    if (!handler) {
      throw new Error(
        `Command handler for ${command.constructor.name} not found`,
      );
    }

    // Apply plugin's wrapHandler
    const result = handler(command, options?.context || this.context);

    if (options?.isVoid) {
      return null as PluginReturnType<TContext, TPlugin, C[COMMAND_RETURN]>;
    }

    return result as PluginReturnType<TContext, TPlugin, C[COMMAND_RETURN]>;
  }
}
