// commandBus.ts
import type { Injector, Type } from "@collidor/injector";
import type { Command, COMMAND_RETURN } from "./commandModel.ts";

type PluginHandler<C extends Command, TContext, R = C[COMMAND_RETURN]> = (
  command: C,
  context: TContext,
  handler?: (command: C, context: TContext) => C[COMMAND_RETURN],
) => R;

interface CommandBusOptions<
  TContext,
  TPlugin extends PluginHandler<Command, TContext, any>,
> {
  context?: TContext;
  plugin?: TPlugin;
}

type ReturnTypeMapper<T, R> = T extends Promise<any> ? Promise<R>
  : T extends Iterable<any> ? Iterable<R>
  : T extends Iterator<any> ? Iterable<R>
  : T extends IterableIterator<any> ? Iterable<R>
  : T extends AsyncIterable<any> ? Iterable<R>
  : T extends AsyncIterator<any> ? Iterable<R>
  : T extends Generator<any> ? Iterable<R>
  : T extends ReadableStream<any> ? Iterable<R>
  : T extends ReadableStreamDefaultReader<any> ? Iterable<R>
  : T;

export class CommandBus<
  TContext extends { inject: Injector["inject"] } = {
    inject: Injector["inject"];
  },
  TPlugin extends PluginHandler<Command, TContext, any> = PluginHandler<
    Command,
    TContext,
    unknown
  >,
> {
  private handlers = new Map<
    string,
    (command: Command, context: TContext) => unknown
  >();
  private plugin?: TPlugin;

  constructor(
    private inject: Injector["inject"],
    options?: CommandBusOptions<TContext, TPlugin>,
  ) {
    this.plugin = options?.plugin;
    this.context = options?.context || { inject } as TContext;
  }

  private context: TContext;

  register<C extends Command>(
    command: Type<C>,
    handler: (
      command: C,
      context: TContext,
    ) =>
      | (ReturnType<TPlugin> extends never ? C[COMMAND_RETURN]
        : ReturnTypeMapper<ReturnType<TPlugin>, C[COMMAND_RETURN]>)
      | C[COMMAND_RETURN],
  ) {
    this.handlers.set(command.name, handler as any);
  }

  execute<C extends Command>(
    command: C,
  ): ReturnType<TPlugin> extends never ? C[COMMAND_RETURN]
    : ReturnTypeMapper<ReturnType<TPlugin>, C[COMMAND_RETURN]> {
    const handler = this.handlers.get(command.constructor.name);

    if (this.plugin) {
      return this.plugin(command, this.context, handler) as any;
    }

    if (!handler) {
      throw new Error(`No handler registered for ${command.constructor.name}`);
    }

    const baseExecution = () => handler(command, this.context);

    return baseExecution() as any;
  }
}
