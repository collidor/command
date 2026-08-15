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
    // deno-lint-ignore require-yield
    bus.registerStreamAsync(ExampleCommand, async function* () {
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
