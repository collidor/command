import type { Command, COMMAND_RETURN } from "./commandModel.ts";
import { BaseCommandBus } from "./baseCommandBus.ts";
import type { CommandBusPlugin, Type } from "./commandBusTypes.ts";

export class CommandBus<
  TContext extends Record<string, any> = Record<string, any>,
  TPlugin extends CommandBusPlugin<Command, TContext> | undefined = undefined,
> extends BaseCommandBus<TContext, TPlugin> {
  register(
    command: Type<Command> | Type<Command>[],
  ): void;
  register<C extends Command>(
    command: Type<C>,
    handler: (
      command: C,
      context: TContext,
      meta?: Record<string, any>,
    ) => C[COMMAND_RETURN], // STRICTLY SYNC
  ): void;
  register<C extends Command>(
    command: Type<C> | Type<Command>[],
    handler?: (
      command: C,
      context: TContext,
      meta?: Record<string, any>,
    ) => C[COMMAND_RETURN],
  ): void {
    const commands = Array.isArray(command) ? command : [command];
    for (const cmd of commands) {
      this.commandConstructor.set(cmd.name, cmd);
      if (handler) {
        this.handlers.set(cmd.name, handler);
      } else {
        this.providedCommands.add(cmd.name);
      }

      if (this.plugin?.register) {
        this.plugin.register(cmd);
      }
      this.notifyAvailabilityChange(cmd.name, true);
    }
  }

  execute<C extends Command>(
    command: C,
    context?: TContext,
  ): C[COMMAND_RETURN] {
    const handler = this.getHandler<C>(command.constructor.name);
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
