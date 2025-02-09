import { assertEquals, assertThrows } from "jsr:@std/assert";
import { Command } from "./commandModel.ts";
import { CommandBus } from "./commandBus.ts";
import { Injector } from "@collidor/injector";

class ExampleCommand extends Command<number> {
  constructor(public readonly value: number) {
    super();
  }
}

Deno.test("commandBus - should bind and run function handler", () => {
  const injector = new Injector();

  const commandBus = new CommandBus(injector.inject);
  commandBus.register(ExampleCommand, (command) => command.value);

  assertEquals(commandBus.execute(new ExampleCommand(42)), 42);
});

Deno.test("commandBus - should throw if handler is not found", () => {
  const injector = new Injector();
  const commandBus = new CommandBus(injector.inject);

  assertThrows(() => {
    commandBus.execute(new ExampleCommand(42));
  });
});

Deno.test("commandBus - should throw if command is not a Command class Instance", () => {
  const injector = new Injector();
  const commandBus = new CommandBus(injector.inject);

  assertThrows(() => {
    commandBus.execute({ value: 42 } as any);
  });
});

Deno.test("commandBus - should bind and run class handler with context", () => {
  const injector = new Injector();

  const context = {
    inject: injector.inject,
    custom: 100,
  };

  const commandBus = new CommandBus(
    injector.inject,
    { context },
  );

  commandBus.register(ExampleCommand, (command, context) => {
    return command.value + context.custom;
  });

  assertEquals(commandBus.execute(new ExampleCommand(42)), 142);
});

Deno.test("commandBus - should register and run handler with context and an Async Plugin", async () => {
  const injector = new Injector();

  const context = {
    inject: injector.inject,
    custom: 100,
  };

  const commandBus = new CommandBus(injector.inject, {
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
