import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { Command, type COMMAND_RETURN } from "./commandModel.ts";
import { CommandBus } from "./commandBus.ts";
import type { CommandBusPlugin } from "./main.ts";
import { spy } from "@std/testing/mock";

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

Deno.test("commandBus - should run multiple stream handlers for the same command", () => {
  const commandBus = new CommandBus();
  commandBus.registerStream(
    ExampleCommand,
    (command, _context, next) => {
      for (let i = 0; i < command.data; i++) {
        next(i, i === command.data - 1);
      }
      return () => {}; // unsubscribe function
    },
  );

  const callback1 = spy();
  commandBus.stream(new ExampleCommand(42), callback1);

  const callback2 = spy();
  commandBus.stream(new ExampleCommand(24), callback2);

  assertEquals(callback1.calls.length, 42);
  assertEquals(callback2.calls.length, 24);
});

Deno.test("commandBus - stream handler should igore output if done is sent twice as true", () => {
  const commandBus = new CommandBus();
  commandBus.registerStream(
    ExampleCommand,
    (command, _context, next) => {
      for (let i = 0; i < command.data; i++) {
        next(i, i === command.data - 1);
      }
      // Send two extra times
      next(command.data, true);
      next(command.data, true);
      return () => {}; // unsubscribe function
    },
  );

  const callback = spy();
  const unsubscribe = commandBus.stream(new ExampleCommand(10), callback);

  unsubscribe();

  assertEquals(callback.calls.length, 10);
});

Deno.test("commandBus - stream handler should unsubscribe if abortController signal is emitted", async () => {
  const commandBus = new CommandBus();
  const abortController = new AbortController();

  commandBus.registerStream(
    ExampleCommand,
    (_command, _context, next) => {
      let i = 0;
      const interval = setInterval(() => {
        next(i++, false);
      }, 10);
      return () => {
        clearInterval(interval);
      };
    },
  );

  const callback = spy();
  const unsubscribe = commandBus.stream(
    new ExampleCommand(10),
    callback,
    { signal: abortController.signal },
  );

  await sleep(50);

  const callsBeforeAbort = callback.calls.length;

  abortController.abort();

  const callsAfterAbort = callback.calls.length;

  await sleep(50); // Wait for the unsubscribe to take effect

  assertEquals(callsBeforeAbort, callsAfterAbort);
  unsubscribe();
});

Deno.test("commandBus - should call plugin streamHandler unsubscribe if abortController signal is emitted", async () => {
  const abortController = new AbortController();

  const plugin: CommandBusPlugin<Command, any, COMMAND_RETURN> = {
    handler: (command, context, next) => {
      return next?.(command, context);
    },
    streamHandler: (_command, _context, callback) => {
      let i = 0;
      const interval = setInterval(() => {
        callback(i++, false);
      }, 10);

      return () => {
        clearInterval(interval);
      };
    },
  };

  const commandBus = new CommandBus({
    plugin,
  });

  const callback = spy();
  const unsubscribe = commandBus.stream(
    new ExampleCommand(10),
    callback,
    {},
    abortController.signal,
  );

  await sleep(50);

  const callsBeforeAbort = callback.calls.length;

  abortController.abort();

  await sleep(50); // Wait for the unsubscribe to take effect

  const callsAfterAbort = callback.calls.length;

  assertEquals(callsBeforeAbort, callsAfterAbort);
  unsubscribe();
});

Deno.test("commandBus - handler should receive plugin metadata", () => {
  const context = {
    custom: 100,
  };

  const metadata = {
    info: "This is some metadata",
    timestamp: Date.now(),
  };

  const plugin: CommandBusPlugin<
    Command,
    typeof context,
    Command[COMMAND_RETURN]
  > = {
    handler: (command, c, h) => h?.(command, c, metadata),
  };

  const commandBus = new CommandBus({
    context,
    plugin,
  });

  let receivedMeta: any;
  commandBus.register(ExampleCommand, (command, context, meta) => {
    receivedMeta = meta;
    return command.data + context.custom;
  });

  assertEquals(
    commandBus.execute(new ExampleCommand(42)),
    142,
  );

  assertEquals(receivedMeta, metadata);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
