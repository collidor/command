import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { Command, type COMMAND_RETURN } from "./commandModel.ts";
import { CommandBus } from "./commandBus.ts";
import type { CommandBusPlugin } from "./main.ts";

class ExampleCommand extends Command<number, number> {
}

Deno.test("commandBus - should bind and run function handler", () => {
  const commandBus = new CommandBus();
  commandBus.register(ExampleCommand, (command) => command.data);

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

/*
    STREAM TESTS
 */

Deno.test("commandBus - should bind and run stream handler", () => {
  const commandBus = new CommandBus();
  commandBus.registerStream(
    ExampleCommand,
    (command, _context, next) => {
      for (let i = 0; i < command.data; i++) {
        next(i, i === command.data - 1);
      }

      return () => {};
    },
  );

  const result: number[] = [];
  commandBus.stream(new ExampleCommand(42), (data) => {
    result.push(data);
  });

  assertEquals(result, Array.from({ length: 42 }, (_, i) => i));
});

Deno.test("commandBus - should throw if stream handler is not found", () => {
  const commandBus = new CommandBus();

  assertThrows(() => {
    commandBus.stream(new ExampleCommand(42), () => {});
  });
});

Deno.test("commandBus - should throw if stream handler is not a stream", () => {
  const commandBus = new CommandBus();
  commandBus.register(ExampleCommand, (command) => command.data);

  assertThrows(() => {
    commandBus.stream(new ExampleCommand(42), () => {});
  });
});

Deno.test("commandBus - should throw if stream handler is not a Command class Instance", () => {
  const commandBus = new CommandBus();

  assertThrows(() => {
    commandBus.stream({ value: 42 } as any, () => {});
  });
});

Deno.test("commandBus - streams - should stop if unsubscribe is called", async () => {
  const commandBus = new CommandBus();
  commandBus.registerStream(
    ExampleCommand,
    (command, _context, next) => {
      let stop = false;
      const timeouts: number[] = [];
      for (let i = 0; i < command.data; i++) {
        timeouts.push(setTimeout(() => {
          if (stop) {
            return;
          }

          next(i, i === command.data - 1);
        }, i * 10));
      }

      return () => {
        stop = true;
        timeouts.forEach((timeout) => clearTimeout(timeout));
      };
    },
  );

  const result: number[] = [];
  const unsubscribe = commandBus.stream(new ExampleCommand(42), (data) => {
    result.push(data);
    unsubscribe();
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  assertEquals(result, [0]);
});

Deno.test("streamAsync - should yield all events", async () => {
  const bus = new CommandBus();
  bus.registerStream(
    ExampleCommand,
    (command, _context, next) => {
      for (let i = 0; i < command.data; i++) {
        next(i, i === command.data - 1);
      }
      return () => {}; // unsubscribe function
    },
  );

  const events: number[] = [];
  for await (const event of bus.streamAsync(new ExampleCommand(5))) {
    events.push(event);
  }
  assertEquals(events, [0, 1, 2, 3, 4]);
});

Deno.test("streamAsync - should throw if stream handler errors", async () => {
  const bus = new CommandBus();
  bus.registerStream(
    ExampleCommand,
    (_command, _context, next) => {
      next(0, false);
      next(0, true, new Error("Stream error"));
      return () => {};
    },
  );

  const iterator = bus.streamAsync(new ExampleCommand(1));
  // Get the first value successfully.
  const first = await iterator.next();
  assertEquals(first.value, 0);
  // The next iteration should throw.
  await assertRejects(
    async () => {
      await iterator.next();
    },
    Error,
    "Stream error",
  );
});

Deno.test("streamAsync - should throw if stream handler throws", async () => {
  const bus = new CommandBus();
  bus.registerStream(
    ExampleCommand,
    (_command, _context, _next) => {
      throw new Error("Stream error");
    },
  );

  const iterator = bus.streamAsync(new ExampleCommand(1));
  await assertRejects(
    async () => {
      await iterator.next();
    },
    Error,
    "Stream error",
  );
});

Deno.test("streamAsync - should register and run AsyncIterator", async () => {
  const bus = new CommandBus();
  bus.registerStreamAsync(
    ExampleCommand,
    async function* (command) {
      for (let i = 0; i < command.data; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield i;
      }
    },
  );

  const events: number[] = [];
  for await (const event of bus.streamAsync(new ExampleCommand(5))) {
    events.push(event);
  }
  assertEquals(events, [0, 1, 2, 3, 4]);
});

/*
    PLUGIN TESTS
 */

Deno.test("commandBus - should bind plugin and run handler with context", () => {
  const context = {
    custom: 100,
  };

  const plugin: CommandBusPlugin<
    Command,
    typeof context,
    Command[COMMAND_RETURN]
  > = {
    handler: (command, c, h) => h?.(command, c),
  };

  const commandBus = new CommandBus(
    { context, plugin },
  );

  commandBus.register(ExampleCommand, (command, context) => {
    return command.data + context.custom;
  });

  assertEquals(commandBus.execute(new ExampleCommand(42)), 142);
});

Deno.test("commandBus - should register and run handler with context and an Async Plugin", async () => {
  const context = {
    custom: 100,
  };

  const plugin: CommandBusPlugin<
    Command,
    typeof context,
    Promise<Command[COMMAND_RETURN]>
  > = {
    handler: (command, c, h) => Promise.resolve(h?.(command, c)),
  };

  const commandBus = new CommandBus({
    context,
    plugin,
  });

  commandBus.register(ExampleCommand, (command, context) => {
    return command.data + context.custom;
  });

  assertEquals(
    await commandBus.execute(new ExampleCommand(42)),
    142,
  );
});

Deno.test("commandBus - should register and run handler with custom context", () => {
  const context = {
    custom: 100,
  };

  const commandBus = new CommandBus({
    context,
  });

  commandBus.register(ExampleCommand, (command, context) => {
    return command.data + context.custom;
  });

  assertEquals(commandBus.execute(new ExampleCommand(42), { custom: 12 }), 54);
});
