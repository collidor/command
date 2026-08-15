import type { Command, COMMAND_RETURN } from "./commandModel.ts";
import { BaseCommandBus } from "./baseCommandBus.ts";
import type { CommandBusPlugin, Type } from "./commandBusTypes.ts";

export class CommandBus<
  TContext extends Record<string, any> = Record<string, any>,
  TPlugin extends CommandBusPlugin<Command, TContext> | undefined = undefined,
> extends BaseCommandBus<TContext, TPlugin> {
  register<C extends Command>(
    command: Type<C>,
    handler: (
      command: C,
      context: TContext,
      meta?: Record<string, any>,
    ) => C[COMMAND_RETURN], // STRICTLY SYNC
  ) {
    this.commandConstructor.set(command.name, command);
    this.handlers.set(command.name, handler);

    if (this.plugin?.register) {
      this.plugin.register(command);
    }
  }

  execute<C extends Command>(
    command: C,
    context?: TContext,
  ): C[COMMAND_RETURN] {
    const handler = this.handlers.get(command.constructor.name);
    const ctx = context ?? this.context;

    // Plugin Interception
    if (this.plugin?.handler) {
      return this.plugin.handler(command, ctx, handler as any);
    }

    if (!handler) {
      throw new Error(`No handler registered for ${command.constructor.name}`);
    }

    // Direct Sync Execution
    return handler(command, ctx);
  }
}
