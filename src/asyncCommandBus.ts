// asyncCommandBus.ts
import type { Command, COMMAND_RETURN } from "./commandModel.ts";
import { BaseCommandBus } from "./baseCommandBus.ts";
import type { AsyncCommandBusPlugin, Type } from "./commandBusTypes.ts";

export class AsyncCommandBus<
  TContext extends Record<string, any> = Record<string, any>,
  TPlugin extends AsyncCommandBusPlugin<Command, TContext> | undefined =
    undefined,
> extends BaseCommandBus<TContext, TPlugin> {
  public asyncStreamHandlers: Map<
    string,
    (
      command: Command,
      context: TContext,
      meta?: Record<string, any>,
    ) => AsyncIterableIterator<any>
  > = new Map();

  register<C extends Command>(
    command: Type<C>,
    handler: (
      command: C,
      context: TContext,
      meta?: Record<string, any>,
    ) => Promise<C[COMMAND_RETURN]> | C[COMMAND_RETURN], // ALLOWS ASYNC
  ) {
    this.commandConstructor.set(command.name, command);
    this.handlers.set(command.name, handler);

    if (this.plugin?.register) {
      this.plugin.register(command);
    }
  }

  async execute<C extends Command>(
    command: C,
    context?: TContext,
  ): Promise<C[COMMAND_RETURN]> {
    const handler = this.handlers.get(command.constructor.name);
    const ctx = context ?? this.context;

    if (this.plugin?.handler) {
      return this.plugin.handler(command, ctx, handler as any);
    }

    if (!handler) {
      throw new Error(`No handler registered for ${command.constructor.name}`);
    }

    // Await the result
    return await handler(command, ctx);
  }

  registerStreamAsync<C extends Command>(
    command: Type<C>,
    handler: (
      command: C,
      context: TContext,
      meta?: Record<string, any>,
    ) => AsyncIterable<C[COMMAND_RETURN]>,
  ) {
    this.commandConstructor.set(command.name, command);
    this.asyncStreamHandlers.set(command.name, handler as any);

    if (this.plugin?.registerStream) {
      this.plugin.registerStream(command);
    }
  }

  async *streamAsync<C extends Command>(
    command: C,
    context?: TContext,
  ): AsyncGenerator<C[COMMAND_RETURN], void, unknown> {
    // 1. Check for native Async Iterator handlers first
    const asyncHandler = this.asyncStreamHandlers.get(command.constructor.name);
    if (asyncHandler) {
      for await (
        const event of asyncHandler(command, context ?? this.context)
      ) {
        yield event;
      }
      return;
    }

    // 2. Fallback to converting callback-stream to async-iterator
    const queue: { value: C[COMMAND_RETURN]; done: boolean; error?: any }[] =
      [];
    let resolveNext: ((res: any) => void) | null = null;
    let finished = false;

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
        if (done) finished = true;
      },
      context,
    );

    try {
      while (!finished || queue.length > 0) {
        if (queue.length > 0) {
          const item = queue.shift()!;
          if (item.error) throw item.error;
          yield item.value;
          if (item.done) break;
        } else {
          const item = await new Promise<any>((resolve) => {
            resolveNext = resolve;
          });
          if (item.error) throw item.error;
          yield item.value;
          if (item.done) break;
        }
      }
    } finally {
      unsubscribe();
    }
  }
}
