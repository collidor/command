import type { Command, COMMAND_RETURN } from "./commandModel.ts";

export type Type<T> = new (...args: any[]) => T;
type ContextType = Record<string, any>;
export type PluginHandler<
  C extends Command,
  TContext extends ContextType = ContextType,
  R = C[COMMAND_RETURN],
> = (
  command: C,
  context: TContext,
  handler?: (command: C, context: TContext) => C[COMMAND_RETURN],
) => R;

export type StreamPluginHandler<
  C extends Command,
  TContext extends ContextType = ContextType,
> = (
  command: C,
  context: TContext,
  next: (data: C[COMMAND_RETURN], done: boolean, error?: any) => void,
) => () => void;

export type CommandBusPlugin<
  C extends Command,
  TContext extends ContextType = ContextType,
  R = undefined,
> = R extends undefined ? {
    install?: (commandBus: CommandBus<TContext, any>) => void;
    handler?: PluginHandler<C, TContext, R>;
    streamHandler?: StreamPluginHandler<C, TContext>;
    register?: (Command: Type<C>) => void;
  }
  : {
    install?: (commandBus: CommandBus<TContext, any>) => void;
    handler: PluginHandler<C, TContext, R>;
    streamHandler?: StreamPluginHandler<C, TContext>;
    register?: (Command: Type<C>) => void;
  };

export interface CommandBusOptions<
  TContext extends ContextType = ContextType,
  TPlugin extends CommandBusPlugin<Command, TContext> | undefined = undefined,
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
  : R;

export class CommandBus<
  TContext extends ContextType = ContextType,
  TPlugin extends CommandBusPlugin<Command, TContext, any> | undefined =
    undefined,
> {
  public handlers: Map<
    string,
    (command: Command, context: TContext) => unknown
  > = new Map();

  public handlersStreamHandlers: Map<
    string,
    (
      command: Command,
      context: TContext,
      next: (data: Command[COMMAND_RETURN], done: boolean, error?: any) => void,
    ) => () => void
  > = new Map();
  public commandConstructor: Map<string, Type<Command>> = new Map();
  private plugin?: TPlugin;

  constructor(
    options?: CommandBusOptions<TContext, TPlugin>,
  ) {
    this.context = options?.context || {} as TContext;
    this.plugin = options?.plugin;

    if (this.plugin?.install) {
      this.plugin.install(this);
    }
  }

  private context: TContext;

  register<C extends Command>(
    command: Type<C>,
    handler: (
      command: C,
      context: TContext,
    ) =>
      | (TPlugin extends { handler: (...args: any[]) => any }
        ? ReturnTypeMapper<
          ReturnType<TPlugin["handler"]>,
          C[COMMAND_RETURN]
        >
        : C[COMMAND_RETURN])
      | C[COMMAND_RETURN],
  ) {
    this.commandConstructor.set(command.name, command);
    this.handlers.set(command.name, handler as any);

    if (this.plugin?.register) {
      this.plugin.register(command);
    }
  }

  execute<C extends Command>(
    command: C,
    context?: TContext,
  ): TPlugin extends { handler: (...args: any[]) => any } ? ReturnTypeMapper<
      ReturnType<TPlugin["handler"]>,
      C[COMMAND_RETURN]
    >
    : C[COMMAND_RETURN] {
    const handler = this.handlers.get(command.constructor.name);

    if (this.plugin?.handler) {
      return this.plugin.handler(
        command,
        context ?? this.context,
        handler,
      ) as any;
    }

    if (!handler) {
      throw new Error(`No handler registered for ${command.constructor.name}`);
    }

    return handler(command, context ?? this.context) as any;
  }

  stream<C extends Command>(
    command: C,
    callback: (data: C[COMMAND_RETURN], done: boolean, error?: any) => void,
    context?: TContext,
  ): () => void {
    if (!this.plugin?.streamHandler) {
      const handler = this.handlersStreamHandlers.get(command.constructor.name);
      if (!handler) {
        throw new Error(
          `No stream plugin registered for ${command.constructor.name}`,
        );
      }

      return handler(
        command,
        context ?? this.context,
        callback,
      );
    }

    return this.plugin.streamHandler(
      command,
      context ?? this.context,
      callback,
    );
  }

  registerStream<C extends Command>(
    command: Type<C>,
    handler: (
      command: C,
      context: TContext,
      next: (data: C[COMMAND_RETURN], done: boolean, error?: any) => void,
    ) => () => void,
  ) {
    this.commandConstructor.set(command.name, command);
    this.handlersStreamHandlers.set(command.name, handler as any);

    if (this.plugin?.register) {
      this.plugin.register(command);
    }
  }
}
