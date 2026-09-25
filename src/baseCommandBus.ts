import type { Command, COMMAND_RETURN } from "./commandModel.ts";
import type {
  AvailabilityChangeOptions,
  BasePlugin,
  CommandBusOptions,
  Type,
  WaitForOptions,
} from "./commandBusTypes.ts";

type ContextType = Record<string, any>;

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
  public context: TContext;
  protected plugin?: TPlugin;

  protected availabilityListeners: Map<
    string,
    Set<(isAvailable: boolean, commandName: string) => void>
  > = new Map();

  protected lastKnownAvailability: Map<string, boolean> = new Map();

  constructor(options?: CommandBusOptions<TContext, TPlugin>) {
    this.context = options?.context || ({} as TContext);
    this.plugin = options?.plugin;

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
    if (this.plugin?.streamHandler) {
      const unsubscribe = this.plugin.streamHandler(
        command,
        context ?? this.context,
        callback,
        abortSignal,
      );
      return this.setupAbort(unsubscribe, abortSignal);
    }

    // 2. Check Registered Handler
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
        if (unsubscribed) return;
        callback(data, done, error);
        if (done) unsubscribed = true;
      },
    );

    return this.setupAbort(unsubscribe, abortSignal, () => {
      unsubscribed = true;
    });
  }

  registerStream<C extends Command>(
    command: Type<C>,
    handler: (
      command: C,
      context: TContext,
      next: (data: C[COMMAND_RETURN], done: boolean, error?: any) => void,
      meta?: Record<string, any>,
    ) => (() => void) | Promise<() => void> | void,
  ) {
    this.commandConstructor.set(command.name, command);
    this.streamHandlers.set(command.name, handler as any);

    if (this.plugin?.registerStream) {
      this.plugin.registerStream(command);
    }
    this.notifyAvailabilityChange(command.name, true);
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
    const asyncHandlers = (this as any).asyncStreamHandlers;
    if (asyncHandlers && typeof asyncHandlers.has === "function") {
      if (asyncHandlers.has(name)) return true;
    }
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
    const asyncHandlers = (this as any).asyncStreamHandlers;
    if (asyncHandlers && typeof asyncHandlers.keys === "function") {
      for (const name of asyncHandlers.keys()) {
        commands.add(name);
      }
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
    command:
      | Type<Command>
      | Command
      | string
      | (Type<Command> | Command | string)[],
    callback: (isAvailable: boolean, commandName: string) => void,
    options?: AvailabilityChangeOptions,
  ): () => void {
    const immediate = options?.immediate ?? true;

    if (Array.isArray(command)) {
      const unsubscribes = command.map((cmd) =>
        this.onAvailabilityChange(
          cmd,
          () => {
            const available = this.isAvailable(command);
            const names = command.map((c) => this.getCommandName(c)).join(",");
            callback(available, names);
          },
          { immediate: false },
        )
      );

      if (immediate) {
        const available = this.isAvailable(command);
        const names = command.map((c) => this.getCommandName(c)).join(",");
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

    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = undefined;
      }
    };

    if (options?.signal) {
      options.signal.addEventListener(
        "abort",
        () => {
          cleanup();
          reject(options.signal?.reason ?? new Error("Aborted"));
        },
        { once: true },
      );
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
    const asyncHandlers = (this as any).asyncStreamHandlers;
    if (asyncHandlers && typeof asyncHandlers.delete === "function") {
      if (asyncHandlers.has(name)) {
        asyncHandlers.delete(name);
        removed = true;
      }
    }

    if (this.plugin?.unregister) {
      this.plugin.unregister(command as any);
    }

    const stillAvailable = this.isAvailable(name);
    if (!stillAvailable) {
      this.notifyAvailabilityChange(name, false);
    }

    return removed;
  }

  // Helper to handle abort logic DRY
  private setupAbort(
    unsubscribe: (() => void) | Promise<() => void> | void,
    abortSignal?: AbortSignal,
    onAbort?: () => void,
  ): () => void {
    if (unsubscribe && abortSignal) {
      abortSignal.addEventListener("abort", () => {
        onAbort?.();
        Promise.resolve(unsubscribe).then((f) => f && f());
      });
    }
    return () => {
      onAbort?.();
      if (unsubscribe) {
        Promise.resolve(unsubscribe).then((f) => f && f());
      }
    };
  }
}
