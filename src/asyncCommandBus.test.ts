import { assertEquals, assertRejects } from "@std/assert";
import { Command } from "./commandModel.ts";
import { AsyncCommandBus } from "./asyncCommandBus.ts"; // The Async Bus
import type { AsyncCommandBusPlugin } from "./commandBusTypes.ts";

// Helper Command
class ExampleCommand extends Command<number, number> {}

Deno.test("AsyncCommandBus - Execution", async (t) => {
  await t.step("should return a Promise", async () => {
    const bus = new AsyncCommandBus();
    bus.register(ExampleCommand, async (cmd) => {
      await Promise.resolve();
      return cmd.data * 2;
    });

    const result = await bus.execute(new ExampleCommand(10));
    assertEquals(result, 20);
  });
});

Deno.test("AsyncCommandBus - Stream Async (Iterators)", async (t) => {
  await t.step(
    "should yield all events from callback-based source",
    async () => {
      const bus = new AsyncCommandBus();
      // Register standard stream handler
      bus.registerStream(ExampleCommand, (cmd, _ctx, next) => {
        for (let i = 0; i < cmd.data; i++) next(i, i === cmd.data - 1);
        return () => {};
      });

      const events: number[] = [];
      for await (const event of bus.streamAsync(new ExampleCommand(4))) {
        events.push(event);
      }
      assertEquals(events, [0, 1, 2, 3]);
    },
  );

  await t.step(
    "should register and run AsyncIterator generator directly",
    async () => {
      const bus = new AsyncCommandBus();

      // Register async generator
      bus.registerStreamAsync(ExampleCommand, async function* (cmd) {
        for (let i = 0; i < cmd.data; i++) {
          await Promise.resolve(); // Simulate work
          yield i;
        }
      });

      const events: number[] = [];
      for await (const event of bus.streamAsync(new ExampleCommand(3))) {
        events.push(event);
      }
      assertEquals(events, [0, 1, 2]);
    },
  );

  await t.step(
    "should throw if underlying stream handler reports error",
    async () => {
      const bus = new AsyncCommandBus();
      bus.registerStream(ExampleCommand, (_cmd, _ctx, next) => {
        next(0, false);
        next(0, true, new Error("Stream error")); // Pass error
        return () => {};
      });

      const iterator = bus.streamAsync(new ExampleCommand(1));
      const first = await iterator.next();
      assertEquals(first.value, 0);

      await assertRejects(
        async () => await iterator.next(),
        Error,
        "Stream error",
      );
    },
  );

  await t.step("should throw if async generator throws", async () => {
    const bus = new AsyncCommandBus();
    bus.registerStreamAsync(ExampleCommand, async function* () {
      if (false as boolean) yield 0;
      throw new Error("Generator error");
    });

    const iterator = bus.streamAsync(new ExampleCommand(1));
    await assertRejects(
      async () => await iterator.next(),
      Error,
      "Generator error",
    );
  });
});

Deno.test("AsyncCommandBus - Plugins", async (t) => {
  await t.step("should support async plugins", async () => {
    const context = { val: 10 };

    // An async plugin wrapper
    const plugin: AsyncCommandBusPlugin<Command, typeof context> = {
      handler: async (cmd, ctx, next) => {
        const result = await next?.(cmd, ctx);
        return (result as number) + 100; // Modify result async
      },
    };

    const bus = new AsyncCommandBus({ context, plugin });
    bus.register(ExampleCommand, (cmd) => cmd.data);

    const result = await bus.execute(new ExampleCommand(50));
    assertEquals(result, 150); // 50 (cmd) + 100 (plugin)
  });
});

Deno.test("AsyncCommandBus - Availability & Readiness", async (t) => {
  class AsyncGenCommand extends Command<number, number> {}

  await t.step("isAvailable should work with registerStreamAsync and unregister", () => {
    const bus = new AsyncCommandBus();
    assertEquals(bus.isAvailable(AsyncGenCommand), false);

    bus.registerStreamAsync(AsyncGenCommand, async function* (cmd) {
      yield cmd.data;
    });

    assertEquals(bus.isAvailable(AsyncGenCommand), true);
    assertEquals(bus.getAvailableCommands(), ["AsyncGenCommand"]);

    const removed = bus.unregister(AsyncGenCommand);
    assertEquals(removed, true);
    assertEquals(bus.isAvailable(AsyncGenCommand), false);
    assertEquals(bus.getAvailableCommands(), []);
  });

  await t.step("waitFor should work with registerStreamAsync", async () => {
    const bus = new AsyncCommandBus();
    let resolved = false;

    const promise = bus.waitFor(AsyncGenCommand).then(() => {
      resolved = true;
    });

    bus.registerStreamAsync(AsyncGenCommand, async function* (cmd) {
      yield cmd.data;
    });

    await promise;
    assertEquals(resolved, true);
  });
});

Deno.test("AsyncCommandBus - DI Provider & Single-Point Registration", async (t) => {
  class AsyncGreetCommand extends Command<string, string> {}
  class AsyncStreamCommand extends Command<number, number> {}

  await t.step(
    "should resolve async handler from provider class instance with async .execute()",
    async () => {
      class AsyncGreetHandler {
        constructor(private prefix: string) {}
        async execute(cmd: AsyncGreetCommand): Promise<string> {
          await Promise.resolve();
          return `${this.prefix} ${cmd.data}!`;
        }
      }

      const bus = new AsyncCommandBus({
        provider: (cmdType) =>
          cmdType === AsyncGreetCommand
            ? new AsyncGreetHandler("Hello")
            : undefined,
      });

      bus.register(AsyncGreetCommand);
      const res = await bus.execute(new AsyncGreetCommand("AsyncWorld"));
      assertEquals(res, "Hello AsyncWorld!");
    },
  );

  await t.step(
    "should resolve streamAsync from provider instance with async *streamAsync()",
    async () => {
      class AsyncStreamHandler {
        async *streamAsync(cmd: AsyncStreamCommand) {
          for (let i = 0; i < cmd.data; i++) {
            await Promise.resolve();
            yield i;
          }
        }
      }

      const bus = new AsyncCommandBus({
        provider: (cmdType) =>
          cmdType === AsyncStreamCommand ? new AsyncStreamHandler() : undefined,
      });

      bus.register(AsyncStreamCommand);

      const items: number[] = [];
      for await (const val of bus.streamAsync(new AsyncStreamCommand(3))) {
        items.push(val);
      }
      assertEquals(items, [0, 1, 2]);
    },
  );

  await t.step(
    "waitFor should work with DI provided commands",
    async () => {
      const bus = new AsyncCommandBus({
        provider: (cmdType) =>
          cmdType === AsyncGreetCommand
            ? { execute: (cmd: AsyncGreetCommand) => `Hi ${cmd.data}` }
            : undefined,
      });

      let available = false;
      const promise = bus.waitFor(AsyncGreetCommand).then(() => {
        available = true;
      });

      assertEquals(available, false);
      bus.register(AsyncGreetCommand);
      await promise;
      assertEquals(available, true);
    },
  );
});

