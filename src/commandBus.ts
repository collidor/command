import type { Command, COMMAND_RETURN } from "./commandModel.ts";

export type Type<T> = new (...args: any[]) => T;

export type PluginHandler<C extends Command, TContext, R = C[COMMAND_RETURN]> =
  (
    command: C,
    context: TContext,
    handler?: (command: C, context: TContext) => C[COMMAND_RETURN],
  ) => R;

export interface CommandBusOptions<
  TContext,
  TPlugin extends PluginHandler<Command, TContext, any> | undefined = undefined,
> {
  context?: TContext;
  plugin?: TPlugin;
}

type ReturnTypeMapper<T, R> = T extends unknown ? R
  : T extends Promise<any> ? Promise<R>
  : T extends Iterable<any> ? Iterable<R>
  : T extends Iterator<any> ? Iterable<R>
  : T extends IterableIterator<any> ? Iterable<R>
  : T extends AsyncIterable<any> ? Iterable<R>
  : T extends AsyncIterator<any> ? Iterable<R>
  : T extends Generator<any> ? Iterable<R>
  : T extends ReadableStream<any> ? Iterable<R>
  : T extends ReadableStreamDefaultReader<any> ? Iterable<R>
  : R;

export class CommandBus<
  TContext extends Record<string, any>,
  TPlugin extends PluginHandler<Command, TContext, any> | undefined =
    PluginHandler<Command, TContext, any>,
> {
  public handlers = new Map<
    string,
    (command: Command, context: TContext) => unknown
  >();
  public commandConstructor = new Map<string, Type<Command>>();
  private plugin?: TPlugin;

  constructor(
    options?: {
      context?: TContext;
      plugin?: TPlugin;
    },
  ) {
    this.plugin = options?.plugin;
    this.context = options?.context || {} as TContext;
  }

  private context: TContext;

  register<C extends Command>(
    command: Type<C>,
    handler: (
      command: C,
      context: TContext,
    ) =>
      | (TPlugin extends (...args: any) => any ? ReturnTypeMapper<
          ReturnType<TPlugin>,
          C[COMMAND_RETURN]
        >
        : C[COMMAND_RETURN])
      | C[COMMAND_RETURN],
  ) {
    this.commandConstructor.set(command.name, command);
    this.handlers.set(command.name, handler as any);
  }

  execute<C extends Command>(
    command: C,
    context?: TContext,
  ): TPlugin extends (...args: any) => any ? ReturnTypeMapper<
      ReturnType<TPlugin>,
      C[COMMAND_RETURN]
    >
    : C[COMMAND_RETURN] {
    const handler = this.handlers.get(command.constructor.name);

    if (this.plugin) {
      return this.plugin(command, context ?? this.context, handler) as any;
    }

    if (!handler) {
      throw new Error(`No handler registered for ${command.constructor.name}`);
    }

    return handler(command, context ?? this.context) as any;
  }
}
