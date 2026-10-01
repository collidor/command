import { Command } from "./commandModel.ts";

export type CommandArgs<T> = [T] extends [void]
  ? [data?: T]
  : undefined extends T
  ? [data?: T]
  : [data: T];

export interface CommandConstructor<T = any, R = any> {
  new (...args: CommandArgs<T>): Command<T, R>;
  readonly prototype: Command<T, R>;
  readonly name: string;
}

/**
 * Creates a command class constructor with an explicit name and types.
 *
 * This protects against bundlers minifying or mangling class names in production,
 * ensuring that command routing and serialization based on `command.constructor.name`
 * remain stable and deterministic.
 *
 * @param name The unique name of the command.
 * @returns A class constructor extending Command<T, R> with the specified name.
 *
 * @example
 * ```ts
 * const PingCommand = createCommand<void, string>("PingCommand");
 * const GreetCommand = createCommand<{ name: string }, string>("GreetCommand");
 *
 * bus.register(GreetCommand, (cmd) => `Hello, ${cmd.data.name}!`);
 * const result = bus.execute(new GreetCommand({ name: "World" }));
 * ```
 */
export function createCommand<T = any, R = any>(
  name: string,
): CommandConstructor<T, R> {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError("Command name must be a non-empty string");
  }

  const CommandClass = class extends Command<T, R> {
    constructor(...args: any[]) {
      super(args[0] as T);
    }
  };

  Object.defineProperty(CommandClass, "name", {
    value: name,
    configurable: true,
  });

  return CommandClass as unknown as CommandConstructor<T, R>;
}
