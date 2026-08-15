import type { Command, COMMAND_RETURN } from "./commandModel.ts";
import type { BasePlugin, CommandBusOptions, Type } from "./commandBusTypes.ts";

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

  constructor(options?: CommandBusOptions<TContext, TPlugin>) {
    this.context = options?.context || ({} as TContext);
    this.plugin = options?.plugin;

    if (this.plugin?.install) {
      this.plugin.install(this, this.context);
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
