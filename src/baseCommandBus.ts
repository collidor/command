import type { Command, COMMAND_RETURN } from "./commandModel.ts";
import type {
  AvailabilityChangeOptions,
  BasePlugin,
  CommandBusOptions,
  CommandHandlerProvider,
  Type,
  WaitForOptions,
} from "./commandBusTypes.ts";

type ContextType = Record<string, any>;
type StreamCallback = (data: any, done: boolean, error?: any) => void;
type StreamTeardown = (() => void) | Promise<() => void> | void;

export abstract class BaseCommandBus<
  TContext extends ContextType,
  TPlugin extends BasePlugin<TContext> | undefined,
> {
  // We use 'any' for the handler signature in the base,
  // because the child classes will enforce strict Sync/Async signatures.
  public handlers: Map<string, (...args: any[]) => any> = new Map();

  public streamHandlers: Map<
    string,
    (
      command: Command,
      context: TContext,
      next: (data: any, done: boolean, error?: any) => void,
      meta?: Record<string, any>,
    ) => (() => void) | void
  > = new Map();

  public commandConstructor: Map<string, Type<Command>> = new Map();
  public providedCommands: Set<string> = new Set();
  public context: TContext;
  protected plugin?: TPlugin;
  protected provider?: CommandHandlerProvider<TContext>;

  protected isSubclassCommandAvailable(_commandName: string): boolean {
    return false;
  }

  protected collectSubclassAvailableCommands(_commands: Set<string>): void {
    // Overridden by subclasses (e.g. AsyncCommandBus)
  }

  protected unregisterSubclassCommand(_commandName: string): boolean {
    return false;
  }

  protected executeSubclassStream(
    _command: Command,
    _callback: (data: any, done: boolean, error?: any) => void,
    _context: TContext,
  ): (() => void) | undefined {
    return undefined;
  }

  protected availabilityListeners: Map<
    string,
    Set<(isAvailable: boolean, commandName: string) => void>
  > = new Map();

  protected lastKnownAvailability: Map<string, boolean> = new Map();

  constructor(options?: CommandBusOptions<TContext, TPlugin>) {
    this.context = options?.context || ({} as TContext);
    this.plugin = options?.plugin;
    this.provider = options?.provider;

    if (this.plugin?.install) {
      this.plugin.install(this, this.context);
    }

    if (this.plugin?.onAvailabilityChange) {
      this.plugin.onAvailabilityChange((commandName) => {
        const available = this.isAvailable(commandName);
        this.notifyAvailabilityChange(commandName, available);
      });
    }
  }

  public setProvider(provider?: CommandHandlerProvider<TContext>): void {
    this.provider = provider;
  }

  public getProvider(): CommandHandlerProvider<TContext> | undefined {
    return this.provider;
  }

  public getHandler<C extends Command>(
    commandName: string,
  ): ((command: C, context?: TContext, meta?: Record<string, any>) => any) | undefined {
    if (this.handlers.has(commandName)) {
      return this.handlers.get(commandName);
    }
    if (this.providedCommands.has(commandName) && this.provider) {
      const constructor = this.commandConstructor.get(commandName);
      if (constructor) {
        return (cmd: C, ctx?: TContext, meta?: Record<string, any>) => {
          const resolved = this.provider!(constructor, ctx ?? this.context);
          if (!resolved) {
            throw new Error(`Provider returned no handler for ${commandName}`);
          }
          if (typeof (resolved as any).execute === "function") {
            return (resolved as any).execute(cmd, ctx ?? this.context, meta);
          }
          if (typeof resolved === "function") {
            return (resolved as any)(cmd, ctx ?? this.context, meta);
          }
          throw new Error(
            `Provider did not return a valid handler or execute method for ${commandName}`,
          );
        };
      }
    }
    return undefined;
  }

  public hasLocalStreamHandler(commandName: string): boolean {
    return (
      this.streamHandlers.has(commandName) ||
      this.isSubclassCommandAvailable(commandName) ||
      this.providedCommands.has(commandName)
    );
  }

  public executeLocalStream<C extends Command>(
    command: C,
    callback: (data: C[COMMAND_RETURN], done: boolean, error?: any) => void,
    context?: TContext,
    abortSignal?: AbortSignal,
  ): () => void {
    const name = command.constructor.name;
    const ctx = context ?? this.context;

    if (abortSignal?.aborted) return () => {};

    // 1. Check Registered Callback Handler
    const handler = this.streamHandlers.get(name);
    if (handler) {
      return this.runStream(
        (next) => handler(command, ctx, next),
        callback,
        abortSignal,
      );
    }

    // 2. Check Subclass Stream Handler (e.g. asyncStreamHandlers in AsyncCommandBus)
    let handledBySubclass = false;
    const stopSubclass = this.runStream((next) => {
      const teardown = this.executeSubclassStream(command, next, ctx);
      handledBySubclass = teardown !== undefined;
      return teardown;
    }, callback, abortSignal);
    if (handledBySubclass) return stopSubclass;
    stopSubclass();

    // 3. Check Provider (Streaming support on provided classes)
    if (this.providedCommands.has(name) && this.provider) {
      const constructor = this.commandConstructor.get(name);
      const resolved: any = constructor
        ? this.provider(constructor, ctx)
        : undefined;

      if (resolved) {
        if (typeof resolved.stream === "function") {
          return this.runStream(
            (next) => resolved.stream(command, ctx, next),
            callback,
            abortSignal,
          );
        }

        if (typeof resolved.streamAsync === "function") {
          return this.runStream(
            (next) =>
              this.pumpAsyncIterable(
                () => resolved.streamAsync(command, ctx),
                next,
              ),
            callback,
            abortSignal,
          );
        }

        const executeFn = typeof resolved.execute === "function"
          ? resolved.execute.bind(resolved)
          : typeof resolved === "function"
          ? resolved
          : undefined;

        if (executeFn) {
          return this.runStream((next) => {
            const res = executeFn(command, ctx);
            if (typeof res?.then === "function") {
              (res as Promise<any>).then(
                (result) => next(result, true),
                (err) => next(null, true, err),
              );
            } else {
              next(res, true);
            }
          }, callback, abortSignal);
        }
      }
    }

    throw new Error(`No local stream handler found for ${name}`);
  }

  /**
   * Shared Stream implementation (Callback based)
   */
  stream<C extends Command>(
    command: C,
    callback: (data: C[COMMAND_RETURN], done: boolean, error?: any) => void,
    context?: TContext,
    abortSignal?: AbortSignal,
  ): () => void {
    // 1. Check Plugin
    const plugin = this.plugin;
    if (plugin?.streamHandler) {
      const ctx = context ?? this.context;
      return this.runStream(
        (next) => plugin.streamHandler!(command, ctx, next, abortSignal),
        callback,
        abortSignal,
      );
    }

    // 2. Local Stream Execution
    return this.executeLocalStream(command, callback, context, abortSignal);
  }

  registerStream(
    command: Type<Command> | Type<Command>[],
  ): void;
  registerStream<C extends Command>(
    command: Type<C>,
    handler: (
      command: C,
      context: TContext,
      next: (data: C[COMMAND_RETURN], done: boolean, error?: any) => void,
      meta?: Record<string, any>,
    ) => (() => void) | Promise<() => void> | void,
  ): void;
  registerStream<C extends Command>(
    command: Type<C> | Type<Command>[],
    handler?: (
      command: C,
      context: TContext,
      next: (data: C[COMMAND_RETURN], done: boolean, error?: any) => void,
      meta?: Record<string, any>,
    ) => (() => void) | Promise<() => void> | void,
  ): void {
    const commands = Array.isArray(command) ? command : [command];
    for (const cmd of commands) {
      this.commandConstructor.set(cmd.name, cmd);
      if (handler) {
        this.streamHandlers.set(cmd.name, handler as any);
      } else {
        this.providedCommands.add(cmd.name);
      }

      if (this.plugin?.registerStream) {
        this.plugin.registerStream(cmd);
      }
      this.notifyAvailabilityChange(cmd.name, true);
    }
  }

  public getCommandName(
    command: Type<Command> | Command | string,
  ): string {
    if (typeof command === "string") return command;
    if (typeof command === "function") return command.name;
    return command.constructor?.name ?? "";
  }

  public isAvailable(
    command:
      | Type<Command>
      | Command
      | string
      | (Type<Command> | Command | string)[],
  ): boolean {
    if (Array.isArray(command)) {
      return command.every((cmd) => this.isSingleCommandAvailable(cmd));
    }
    return this.isSingleCommandAvailable(command);
  }

  private isSingleCommandAvailable(
    command: Type<Command> | Command | string,
  ): boolean {
    const name = this.getCommandName(command);
    if (this.handlers.has(name)) return true;
    if (this.streamHandlers.has(name)) return true;
    if (this.isSubclassCommandAvailable(name)) return true;
    if (this.providedCommands.has(name)) return true;
    if (this.plugin?.isAvailable) {
      return this.plugin.isAvailable(name);
    }
    return false;
  }

  public getAvailableCommands(): string[] {
    const commands = new Set<string>();
    for (const name of this.handlers.keys()) {
      commands.add(name);
    }
    for (const name of this.streamHandlers.keys()) {
      commands.add(name);
    }
    this.collectSubclassAvailableCommands(commands);
    for (const name of this.providedCommands) {
      commands.add(name);
    }
    if (this.plugin?.getAvailableCommands) {
      for (const name of this.plugin.getAvailableCommands()) {
        commands.add(name);
      }
    }
    return Array.from(commands);
  }

  public notifyAvailabilityChange(
    commandName: string,
    isAvailable: boolean,
  ): void {
    const previous = this.lastKnownAvailability.get(commandName);
    if (previous === isAvailable) {
      return;
    }
    this.lastKnownAvailability.set(commandName, isAvailable);
    const listeners = this.availabilityListeners.get(commandName);
    if (listeners) {
      for (const listener of Array.from(listeners)) {
        listener(isAvailable, commandName);
      }
    }
  }

  public onAvailabilityChange(
    command: (Type<Command> | Command | string)[],
    callback: (isAvailable: boolean, commands: string[]) => void,
    options?: AvailabilityChangeOptions,
  ): () => void;
  public onAvailabilityChange(
    command: Type<Command> | Command | string,
    callback: (isAvailable: boolean, commandName: string) => void,
    options?: AvailabilityChangeOptions,
  ): () => void;
  public onAvailabilityChange(
    command:
      | Type<Command>
      | Command
      | string
      | (Type<Command> | Command | string)[],
    callback: (isAvailable: boolean, command: any) => void,
    options?: AvailabilityChangeOptions,
  ): () => void;
  public onAvailabilityChange(
    command:
      | Type<Command>
      | Command
      | string
      | (Type<Command> | Command | string)[],
    callback: (isAvailable: boolean, command: any) => void,
    options?: AvailabilityChangeOptions,
  ): () => void {
    const immediate = options?.immediate ?? true;

    if (Array.isArray(command)) {
      const names = command.map((c) => this.getCommandName(c));

      const unsubscribes = command.map((cmd) =>
        this.onAvailabilityChange(
          cmd,
          () => {
            const available = this.isAvailable(command);
            callback(available, names);
          },
          { immediate: false },
        )
      );

      if (immediate) {
        const available = this.isAvailable(command);
        callback(available, names);
      }

      return () => {
        for (const unsub of unsubscribes) {
          unsub();
        }
      };
    }

    const name = this.getCommandName(command);
    let listeners = this.availabilityListeners.get(name);
    if (!listeners) {
      listeners = new Set();
      this.availabilityListeners.set(name, listeners);
    }
    listeners.add(callback);

    if (immediate) {
      const available = this.isAvailable(name);
      callback(available, name);
    }

    return () => {
      const set = this.availabilityListeners.get(name);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this.availabilityListeners.delete(name);
        }
      }
    };
  }

  public waitFor(
    command:
      | Type<Command>
      | Command
      | string
      | (Type<Command> | Command | string)[],
    options?: WaitForOptions,
  ): Promise<void> {
    if (this.isAvailable(command)) {
      return Promise.resolve();
    }

    if (options?.signal?.aborted) {
      return Promise.reject(options.signal.reason ?? new Error("Aborted"));
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let timer: any;
    let unsubscribe: (() => void) | undefined;
    let onAbort: (() => void) | undefined;

    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = undefined;
      }
      if (options?.signal && onAbort) {
        options.signal.removeEventListener("abort", onAbort);
        onAbort = undefined;
      }
    };

    if (options?.signal) {
      onAbort = () => {
        cleanup();
        reject(options.signal?.reason ?? new Error("Aborted"));
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    if (options?.timeout !== undefined && options.timeout > 0) {
      timer = setTimeout(() => {
        cleanup();
        const names = Array.isArray(command)
          ? command.map((c) => this.getCommandName(c)).join(", ")
          : this.getCommandName(command);
        reject(new Error(`Timeout waiting for command(s): ${names}`));
      }, options.timeout);
    }

    unsubscribe = this.onAvailabilityChange(
      command,
      (isAvail) => {
        if (isAvail) {
          cleanup();
          resolve();
        }
      },
      { immediate: false },
    );

    return promise;
  }

  public unregister(command: Type<Command> | Command | string): boolean {
    const name = this.getCommandName(command);
    let removed = false;

    if (this.handlers.has(name)) {
      this.handlers.delete(name);
      removed = true;
    }
    if (this.streamHandlers.has(name)) {
      this.streamHandlers.delete(name);
      removed = true;
    }
    if (this.unregisterSubclassCommand(name)) {
      removed = true;
    }
    if (this.providedCommands.has(name)) {
      this.providedCommands.delete(name);
      removed = true;
    }

    if (this.plugin?.unregister) {
      // Plugins expect the command type when we know it, not a caller-supplied instance.
      this.plugin.unregister(this.commandConstructor.get(name) ?? name);
    }
    this.commandConstructor.delete(name);

    const stillAvailable = this.isAvailable(name);
    if (!stillAvailable) {
      this.notifyAvailabilityChange(name, false);
    }

    return removed;
  }

  /**
   * Runs a stream producer with a uniform lifecycle:
   * - the producer may throw, or reject its teardown promise: the failure is
   *   delivered to `callback` as a final `done` frame instead of escaping;
   * - once a `done` frame is delivered (or the returned function / the abort
   *   signal fires) further frames are dropped and the teardown runs once;
   * - the abort listener is removed as soon as the stream finishes.
   */
  private runStream(
    start: (next: StreamCallback) => StreamTeardown,
    callback: StreamCallback,
    abortSignal?: AbortSignal,
  ): () => void {
    if (abortSignal?.aborted) return () => {};

    let finished = false;
    let teardown: (() => void) | undefined;
    let removeAbort: (() => void) | undefined;

    const runTeardown = (fn: () => void) => {
      try {
        fn();
      } catch {
        // a failing teardown must not break the stream lifecycle
      }
    };

    const release = () => {
      removeAbort?.();
      removeAbort = undefined;
      const fn = teardown;
      teardown = undefined;
      if (fn) runTeardown(fn);
    };

    const stop = () => {
      if (finished) return;
      finished = true;
      release();
    };

    let consumerError: { error: unknown } | undefined;

    const next: StreamCallback = (data, done, error) => {
      if (finished) return;
      if (done) finished = true;
      try {
        callback(data, done, error);
      } catch (e) {
        consumerError = { error: e };
        throw e;
      } finally {
        if (done) release();
      }
    };

    // The producer may hand back its teardown after the stream already
    // finished (synchronous `done`, or an async setup); run it right away then.
    const attach = (fn: (() => void) | void) => {
      if (typeof fn !== "function") return;
      if (finished) {
        runTeardown(fn);
      } else {
        teardown = fn;
      }
    };

    let started: StreamTeardown;
    try {
      started = start(next);
    } catch (error) {
      // Not a producer failure: the stream already completed, or the throw
      // came from the consumer's own callback. Don't feed it back to it.
      if (finished || consumerError?.error === error) throw error;
      next(null, true, error);
      return () => {};
    }

    if (typeof (started as any)?.then === "function") {
      (started as Promise<() => void>).then(
        attach,
        (error) => next(null, true, error),
      );
    } else {
      attach(started as (() => void) | void);
    }

    if (!finished && abortSignal) {
      if (abortSignal.aborted) {
        stop();
      } else {
        const onAbort = () => stop();
        abortSignal.addEventListener("abort", onAbort, { once: true });
        removeAbort = () => abortSignal.removeEventListener("abort", onAbort);
      }
    }

    return stop;
  }

  /**
   * Forwards an async iterable to a stream callback. The returned function
   * stops the forwarding and closes the iterator.
   */
  protected pumpAsyncIterable(
    source: () => AsyncIterable<any>,
    next: StreamCallback,
  ): () => void {
    let stopped = false;
    let iterator: AsyncIterator<any> | undefined;
    (async () => {
      try {
        iterator = source()[Symbol.asyncIterator]();
        while (!stopped) {
          const result = await iterator.next();
          if (stopped) return;
          if (result.done) break;
          next(result.value, false);
        }
        next(null, true);
      } catch (error) {
        next(null, true, error);
      }
    })();
    return () => {
      if (stopped) return;
      stopped = true;
      try {
        Promise.resolve(iterator?.return?.()).catch(() => {});
      } catch {
        // ignore
      }
    };
  }
}
