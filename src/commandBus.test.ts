import { assertEquals, assertThrows } from "@std/assert";
import { spy } from "@std/testing/mock";
import { Command } from "./commandModel.ts";
import { CommandBus } from "./commandBus.ts"; // The Sync Bus
import type { CommandBusPlugin } from "./commandBusTypes.ts";

// Helper Command
class ExampleCommand extends Command<number, number> {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.test("CommandBus (Sync) - Execution", async (t) => {
  await t.step("should bind and run function handler", () => {
    const bus = new CommandBus();
    bus.register(ExampleCommand, (cmd) => cmd.data);
    assertEquals(bus.execute(new ExampleCommand(42)), 42);
  });

  await t.step("should throw if handler is not found", () => {
    const bus = new CommandBus();
    assertThrows(() => {
      bus.execute(new ExampleCommand(42));
    });
  });

  await t.step(
    "should throw if command is not a Command class Instance",
    () => {
      const bus = new CommandBus();
      assertThrows(() => {
        bus.execute({ value: 42 } as any);
      });
    },
  );

  await t.step("should register and run handler with custom context", () => {
    const context = { custom: 100 };
    const bus = new CommandBus({ context });

    bus.register(ExampleCommand, (cmd, ctx) => {
      return cmd.data + ctx.custom;
    });

    // Override context at execution time
    assertEquals(bus.execute(new ExampleCommand(42), { custom: 12 }), 54);
  });
});

Deno.test("CommandBus (Sync) - Callback Streaming", async (t) => {
  await t.step("should bind and run stream handler", () => {
    const bus = new CommandBus();
    bus.registerStream(ExampleCommand, (cmd, _ctx, next) => {
      for (let i = 0; i < cmd.data; i++) {
        next(i, i === cmd.data - 1);
      }
      return () => {};
    });

    const result: number[] = [];
    bus.stream(new ExampleCommand(5), (data) => result.push(data));
    assertEquals(result, [0, 1, 2, 3, 4]);
  });

  await t.step("should throw if stream handler is not found", () => {
    const bus = new CommandBus();
    assertThrows(() => {
      bus.stream(new ExampleCommand(42), () => {});
    });
  });

  await t.step("should run multiple stream handlers independently", () => {
    const bus = new CommandBus();
    bus.registerStream(ExampleCommand, (cmd, _ctx, next) => {
      next(cmd.data, true);
    });

    const cb1 = spy();
    const cb2 = spy();

    bus.stream(new ExampleCommand(1), cb1);
    bus.stream(new ExampleCommand(2), cb2);

    assertEquals(cb1.calls[0].args[0], 1);
    assertEquals(cb2.calls[0].args[0], 2);
  });

  await t.step("should unsubscribe on AbortSignal", async () => {
    const bus = new CommandBus();
    const ac = new AbortController();

    bus.registerStream(ExampleCommand, (_cmd, _ctx, next) => {
      let i = 0;
      const interval = setInterval(() => next(i++, false), 10);
      return () => clearInterval(interval);
    });

    const cb = spy();
    const unsubscribe = bus.stream(new ExampleCommand(10), cb, {}, ac.signal);

    await sleep(50);
    const countBefore = cb.calls.length;

    ac.abort();
    await sleep(50); // Wait for cleanup

    const countAfter = cb.calls.length;
    assertEquals(countBefore, countAfter);

    unsubscribe(); // Clean up listener manually if needed
  });
});

Deno.test("CommandBus (Sync) - Plugins", async (t) => {
  await t.step("should bind plugin and run handler with context", () => {
    const context = { custom: 100 };
    const plugin: CommandBusPlugin<Command, typeof context> = {
      handler: (cmd, ctx, next) => next?.(cmd, ctx),
    };

    const bus = new CommandBus({ context, plugin });

    bus.register(ExampleCommand, (cmd, ctx) => cmd.data + ctx.custom);
    assertEquals(bus.execute(new ExampleCommand(42)), 142);
  });

  await t.step("handler should receive plugin metadata", () => {
    const context = { custom: 100 };
    const metadata = { info: "meta", timestamp: 123 };

    const plugin: CommandBusPlugin<Command, typeof context> = {
      handler: (cmd, ctx, next) => next?.(cmd, ctx, metadata),
    };

    const bus = new CommandBus({ context, plugin });

    let receivedMeta: any;
    bus.register(ExampleCommand, (cmd, ctx, meta) => {
      receivedMeta = meta;
      return cmd.data + ctx.custom;
    });

    bus.execute(new ExampleCommand(1));
    assertEquals(receivedMeta, metadata);
  });
});
