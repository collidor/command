import { assertEquals, assertThrows } from "jsr:@std/assert";
import { Command } from "./commandModel.ts";
import { CommandBus } from "./commandBus.ts";

class ExampleCommand extends Command<number> {
  constructor(public readonly value: number) {
    super();
  }
}

Deno.test("commandBus - should bind and run function handler", () => {
  const commandBus = new CommandBus();
  commandBus.register(ExampleCommand, (command) => command.value);

  assertEquals(commandBus.execute(new ExampleCommand(42)), 42);
});

Deno.test("commandBus - should throw if handler is not found", () => {
  const commandBus = new CommandBus();

  assertThrows(() => {
    commandBus.execute(new ExampleCommand(42));
  });
});

Deno.test("commandBus - should throw if command is not a Command class Instance", () => {
  const commandBus = new CommandBus();

  assertThrows(() => {
    commandBus.execute({ value: 42 } as any);
  });
});

Deno.test("commandBus - should bind and run class handler with context", () => {
  const context = {
    custom: 100,
  };

  const commandBus = new CommandBus(
    { context },
  );

  commandBus.register(ExampleCommand, (command, context) => {
    return command.value + context.custom;
  });

  assertEquals(commandBus.execute(new ExampleCommand(42)), 142);
});

Deno.test("commandBus - should register and run handler with context and an Async Plugin", async () => {
  const context = {
    custom: 100,
  };

  const commandBus = new CommandBus({
    context,
    plugin: (command, context, handler) => {
      return Promise.resolve(handler?.(command, context));
    },
  });

  commandBus.register(ExampleCommand, (command, context) => {
    return command.value + context.custom;
  });

  assertEquals(
    await commandBus.execute(new ExampleCommand(42)),
    142,
  );
});
