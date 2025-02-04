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
  commandBus.bind(ExampleCommand, (command) => command.value);

  assertEquals(commandBus.execute(new ExampleCommand(42)), 42);
});

Deno.test("commandBus - should bind and run class handler", () => {
  const injector = new Injector();
  const commandBus = new CommandBus(injector.inject);

  @commandBus.handler(ExampleCommand)
  class ExampleHandler {
    execute(command: ExampleCommand) {
      return command.value;
    }
  }

  injector.register(ExampleHandler, new ExampleHandler());

  assertEquals(commandBus.execute(new ExampleCommand(42)), 42);
});

Deno.test("commandBus - should throw if handler is not found", () => {
  const injector = new Injector();
  const commandBus = new CommandBus(injector.inject);

  assertThrows(() => {
    commandBus.execute(new ExampleCommand(42));
  });
});
