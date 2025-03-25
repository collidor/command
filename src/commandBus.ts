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
  abortSignal?: AbortSignal,
) => (() => void) | Promise<() => void>;

export type CommandBusPlugin<
  C extends Command,
  TContext extends ContextType = ContextType,
  R = undefined,
> =
  & {
    install?: (
      commandBus: CommandBus<TContext, any>,
      context: TContext,
    ) => void;
    streamHandler?: StreamPluginHandler<C, TContext>;
    register?: (Command: Type<C>) => void;
    registerStream?: (
      Command: Type<C>,
    ) => void;
  }
  & (R extends undefined ? {
      handler?: PluginHandler<C, TContext, R>;
    }
    : {
      handler: PluginHandler<C, TContext, R>;
    });

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
  TPlugin extends CommandBusPlugin<Command, any, any> | undefined = undefined,
> {
  public handlers: Map<
    string,
    (command: Command, context: TContext) => unknown
  > = new Map();

  public streamHandlers: Map<
    string,
    (
      command: Command,
      context: TContext,
      next: (data: Command[COMMAND_RETURN], done: boolean, error?: any) => void,
    ) => (() => void) | Promise<() => void> | void
  > = new Map();

  public asyncStreamHandlers: Map<
    string,
    (
      command: Command,
      context: TContext,
    ) => AsyncIterableIterator<Command[COMMAND_RETURN]>
  > = new Map();

  public commandConstructor: Map<string, Type<Command>> = new Map();
  private plugin?: TPlugin;

  constructor(
    options?: CommandBusOptions<TContext, TPlugin>,
  ) {
    this.context = options?.context || {} as TContext;
    this.plugin = options?.plugin;

    if (this.plugin?.install) {
      this.plugin.install(this, this.context);
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
    abortSignal?: AbortSignal,
  ): () => void {
    if (!this.plugin?.streamHandler) {
      const handler = this.streamHandlers.get(command.constructor.name);
      if (!handler) {
        throw new Error(
          `No stream plugin registered for ${command.constructor.name}`,
        );
      }

      let unsubscribed = false;
      const unsubscribe = handler(
        command,
        context ?? this.context,
        (data, done, error) => {
          if (unsubscribed) {
            return;
          }

          if (error) {
            callback(data, done, error);
            return;
          }

          callback(data, done);
          if (done) {
            unsubscribed = true;
          }
        },
      );

      if (unsubscribe && abortSignal) {
        abortSignal.addEventListener("abort", () => {
          unsubscribed = true;
          Promise.resolve(unsubscribe).then((f) => f());
        });
      }

      return () => {
        unsubscribed = true;
        if (unsubscribe) {
          Promise.resolve(unsubscribe).then((f) => f());
        }
      };
    }

    const unsubscribe = this.plugin.streamHandler(
      command,
      context ?? this.context,
      callback,
      abortSignal,
    );

    if (unsubscribe && abortSignal) {
      abortSignal.addEventListener("abort", () => {
        Promise.resolve(unsubscribe).then((f) => f());
      });
    }

    return () => {
      if (unsubscribe) {
        Promise.resolve(unsubscribe).then((f) => f());
      }
    };
  }

  async *streamAsync<C extends Command>(
    command: C,
    context?: TContext,
  ): AsyncGenerator<C[COMMAND_RETURN], void, unknown> {
    if (!this.plugin?.streamHandler) {
      const asyncHandler = this.asyncStreamHandlers.get(
        command.constructor.name,
      );
      if (asyncHandler) {
        for await (
          const event of asyncHandler(command, context ?? this.context)
        ) {
          yield event;
        }
        return;
      }
    }

    const queue: {
      value: C[COMMAND_RETURN];
      done: boolean;
      error?: any;
    }[] = [];
    let resolveNext:
      | ((result: {
        value: C[COMMAND_RETURN];
        done: boolean;
        error?: any;
      }) => void)
      | null = null;
    let finished = false;

    // Subscribe to the stream.
    const unsubscribe = this.stream(
      command,
      (data, done, error) => {
        const item = { value: data, done, error };
        if (resolveNext) {
          resolveNext(item);
          resolveNext = null;
        } else {
          queue.push(item);
        }
        if (done) {
          finished = true;
        }
      },
      context,
    );

    try {
      while (!finished || queue.length > 0) {
        const item = queue.length > 0 ? queue.shift()! : await new Promise<{
          value: C[COMMAND_RETURN];
          done: boolean;
          error?: any;
        }>((resolve) => {
          resolveNext = resolve;
        });
        if (item.error) {
          throw item.error;
        }
        yield item.value;
        if (item.done) {
          break;
        }
      }
    } finally {
      unsubscribe();
    }
  }

  registerStream<C extends Command>(
    command: Type<C>,
    handler: (
      command: C,
      context: TContext,
      next: (data: C[COMMAND_RETURN], done: boolean, error?: any) => void,
    ) => (() => void) | Promise<() => void> | void,
  ) {
    this.commandConstructor.set(command.name, command);
    this.streamHandlers.set(command.name, handler as any);

    if (this.plugin?.registerStream) {
      this.plugin.registerStream(command);
    }
  }

  /**
   * Registers a stream handler that returns an AsyncIterable.
   */
  registerStreamAsync<C extends Command>(
    command: Type<C>,
    handler: (
      command: C,
      context: TContext,
    ) => AsyncIterable<C[COMMAND_RETURN]>,
  ) {
    this.commandConstructor.set(command.name, command);
    this.asyncStreamHandlers.set(command.name, handler as any);

    if (this.plugin?.registerStream) {
      this.plugin.registerStream(command);
    }
  }
}
