import { assertEquals, assertRejects, assertThrows } from "@std/assert";
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

Deno.test("CommandBus (Sync) - Availability & Readiness", async (t) => {
  class CommandA extends Command<string, string> {}
  class CommandB extends Command<number, number> {}

  await t.step("isAvailable should report correct status", () => {
    const bus = new CommandBus();
    assertEquals(bus.isAvailable(CommandA), false);
    assertEquals(bus.isAvailable("CommandA"), false);
    assertEquals(bus.isAvailable([CommandA, CommandB]), false);

    bus.register(CommandA, (cmd) => cmd.data);
    assertEquals(bus.isAvailable(CommandA), true);
    assertEquals(bus.isAvailable("CommandA"), true);
    assertEquals(bus.isAvailable([CommandA]), true);
    assertEquals(bus.isAvailable([CommandA, CommandB]), false);

    bus.register(CommandB, (cmd) => cmd.data);
    assertEquals(bus.isAvailable([CommandA, CommandB]), true);

    const removed = bus.unregister(CommandA);
    assertEquals(removed, true);
    assertEquals(bus.isAvailable(CommandA), false);
    assertEquals(bus.isAvailable([CommandA, CommandB]), false);
    assertEquals(bus.isAvailable(CommandB), true);
  });

  await t.step("getAvailableCommands should return current available list", () => {
    const bus = new CommandBus();
    assertEquals(bus.getAvailableCommands(), []);

    bus.register(CommandA, (cmd) => cmd.data);
    assertEquals(bus.getAvailableCommands(), ["CommandA"]);

    bus.registerStream(CommandB, (cmd, _ctx, next) => {
      next(cmd.data, true);
    });
    assertEquals(new Set(bus.getAvailableCommands()), new Set(["CommandA", "CommandB"]));

    bus.unregister(CommandA);
    assertEquals(bus.getAvailableCommands(), ["CommandB"]);
  });

  await t.step("onAvailabilityChange should invoke callback with immediate state and transitions", () => {
    const bus = new CommandBus();
    const transitions: { isAvailable: boolean; name: string }[] = [];

    const unsubscribe = bus.onAvailabilityChange(CommandA, (isAvailable, name) => {
      transitions.push({ isAvailable, name });
    }, { immediate: true });

    assertEquals(transitions, [{ isAvailable: false, name: "CommandA" }]);

    bus.register(CommandA, (cmd) => cmd.data);
    assertEquals(transitions, [
      { isAvailable: false, name: "CommandA" },
      { isAvailable: true, name: "CommandA" },
    ]);

    bus.unregister(CommandA);
    assertEquals(transitions, [
      { isAvailable: false, name: "CommandA" },
      { isAvailable: true, name: "CommandA" },
      { isAvailable: false, name: "CommandA" },
    ]);

    unsubscribe();
    bus.register(CommandA, (cmd) => cmd.data);
    // No more notifications after unsubscribe
    assertEquals(transitions.length, 3);
  });

  await t.step("onAvailabilityChange should support immediate: false", () => {
    const bus = new CommandBus();
    const transitions: boolean[] = [];

    bus.onAvailabilityChange(CommandA, (isAvailable) => {
      transitions.push(isAvailable);
    }, { immediate: false });

    assertEquals(transitions.length, 0);

    bus.register(CommandA, (cmd) => cmd.data);
    assertEquals(transitions, [true]);
  });

  await t.step("onAvailabilityChange should support array of commands", () => {
    const bus = new CommandBus();
    const states: boolean[] = [];

    bus.onAvailabilityChange([CommandA, CommandB], (isAvailable) => {
      states.push(isAvailable);
    }, { immediate: true });

    assertEquals(states, [false]);

    bus.register(CommandA, (cmd) => cmd.data);
    assertEquals(states, [false, false]); // CommandB still missing

    bus.register(CommandB, (cmd) => cmd.data);
    assertEquals(states, [false, false, true]); // Both now available
  });

  await t.step("waitFor should resolve immediately if already available", async () => {
    const bus = new CommandBus();
    bus.register(CommandA, (cmd) => cmd.data);

    let resolved = false;
    await bus.waitFor(CommandA).then(() => {
      resolved = true;
    });
    assertEquals(resolved, true);
  });

  await t.step("waitFor should wait and resolve when command becomes available", async () => {
    const bus = new CommandBus();
    let resolved = false;

    const promise = bus.waitFor(CommandA).then(() => {
      resolved = true;
    });

    assertEquals(resolved, false);
    await sleep(20);
    assertEquals(resolved, false);

    bus.register(CommandA, (cmd) => cmd.data);
    await promise;
    assertEquals(resolved, true);
  });

  await t.step("waitFor should reject on timeout", async () => {
    const bus = new CommandBus();
    await assertRejects(
      () => bus.waitFor(CommandA, { timeout: 50 }),
      Error,
      "Timeout waiting for command(s): CommandA",
    );
  });

  await t.step("waitFor should reject on AbortSignal", async () => {
    const bus = new CommandBus();
    const ac = new AbortController();

    const promise = bus.waitFor(CommandA, { signal: ac.signal });
    ac.abort(new Error("Custom abort"));

    await assertRejects(() => promise, Error, "Custom abort");
  });

  await t.step("waitFor should handle array of commands", async () => {
    const bus = new CommandBus();
    let resolved = false;

    const promise = bus.waitFor([CommandA, CommandB]).then(() => {
      resolved = true;
    });

    bus.register(CommandA, (cmd) => cmd.data);
    await sleep(20);
    assertEquals(resolved, false);

    bus.register(CommandB, (cmd) => cmd.data);
    await promise;
    assertEquals(resolved, true);
  });
});

Deno.test("CommandBus (Sync) - DI Provider & Single-Point Registration", async (t) => {
  class GreetCommand extends Command<string, string> {}
  class AddCommand extends Command<{ a: number; b: number }, number> {}
  class StreamCommand extends Command<number, number> {}

  await t.step(
    "should resolve handler from provider class instance with .execute()",
    () => {
      class GreetHandler {
        constructor(private prefix: string) {}
        execute(cmd: GreetCommand): string {
          return `${this.prefix} ${cmd.data}!`;
        }
      }

      const container = new Map<any, any>();
      container.set(GreetCommand, new GreetHandler("Hello"));

      const bus = new CommandBus({
        provider: (cmdType) => container.get(cmdType),
      });

      bus.register(GreetCommand);

      assertEquals(bus.execute(new GreetCommand("World")), "Hello World!");
    },
  );

  await t.step("should resolve handler from provider function", () => {
    const bus = new CommandBus({
      provider: (cmdType) => {
        if (cmdType === GreetCommand) {
          return (cmd: GreetCommand) => `Hi, ${cmd.data}`;
        }
      },
    });

    bus.register(GreetCommand);
    assertEquals(bus.execute(new GreetCommand("Alice")), "Hi, Alice");
  });

  await t.step("should support runtime setProvider and getProvider", () => {
    const bus = new CommandBus();
    assertEquals(bus.getProvider(), undefined);

    const provider = (cmdType: any) => {
      if (cmdType === AddCommand) {
        return {
          execute: (cmd: AddCommand) => cmd.data.a + cmd.data.b,
        };
      }
    };

    bus.setProvider(provider);
    assertEquals(bus.getProvider(), provider);

    bus.register(AddCommand);
    assertEquals(bus.execute(new AddCommand({ a: 10, b: 20 })), 30);
  });

  await t.step(
    "should support single-point registration bus.register([CmdA, CmdB])",
    () => {
      const bus = new CommandBus({
        provider: (cmdType) => {
          if (cmdType === GreetCommand) {
            return (cmd: GreetCommand) => `Yo ${cmd.data}`;
          }
          if (cmdType === AddCommand) {
            return {
              execute: (cmd: AddCommand) => cmd.data.a + cmd.data.b,
            };
          }
        },
      });

      bus.register([GreetCommand, AddCommand]);
      assertEquals(bus.isAvailable(GreetCommand), true);
      assertEquals(bus.isAvailable(AddCommand), true);
      assertEquals(
        bus.getAvailableCommands().sort(),
        ["AddCommand", "GreetCommand"].sort(),
      );

      assertEquals(bus.execute(new GreetCommand("Bob")), "Yo Bob");
      assertEquals(bus.execute(new AddCommand({ a: 5, b: 5 })), 10);
    },
  );

  await t.step("should give precedence to inline handler over provider", () => {
    const bus = new CommandBus({
      provider: (cmdType) => {
        if (cmdType === GreetCommand) return () => "from-provider";
      },
    });

    bus.register(GreetCommand, () => "from-inline");
    assertEquals(bus.execute(new GreetCommand("test")), "from-inline");
  });

  await t.step(
    "should throw informative error if provider returns undefined or invalid handler",
    () => {
      const bus = new CommandBus({
        provider: () => undefined,
      });
      bus.register(GreetCommand);
      assertThrows(
        () => bus.execute(new GreetCommand("test")),
        Error,
        "Provider returned no handler for GreetCommand",
      );

      const busInvalid = new CommandBus({
        provider: () => ({} as any),
      });
      busInvalid.register(GreetCommand);
      assertThrows(
        () => busInvalid.execute(new GreetCommand("test")),
        Error,
        "Provider did not return a valid handler or execute method for GreetCommand",
      );
    },
  );

  await t.step(
    "unregister should remove provided commands and update availability",
    () => {
      const bus = new CommandBus({
        provider: () => () => "ok",
      });

      bus.register(GreetCommand);
      assertEquals(bus.isAvailable(GreetCommand), true);

      const removed = bus.unregister(GreetCommand);
      assertEquals(removed, true);
      assertEquals(bus.isAvailable(GreetCommand), false);
      assertEquals(bus.getAvailableCommands().includes("GreetCommand"), false);
    },
  );

  await t.step(
    "stream should delegate to provider instance stream() method",
    () => {
      class StreamHandler {
        stream(
          cmd: StreamCommand,
          _ctx: any,
          next: (data: number, done: boolean) => void,
        ) {
          for (let i = 0; i < cmd.data; i++) {
            next(i, i === cmd.data - 1);
          }
          return () => {};
        }
      }

      const bus = new CommandBus({
        provider: (cmdType) =>
          cmdType === StreamCommand ? new StreamHandler() : undefined,
      });
      bus.register(StreamCommand);

      const results: number[] = [];
      bus.stream(new StreamCommand(3), (val) => results.push(val));
      assertEquals(results, [0, 1, 2]);
    },
  );

  await t.step(
    "stream should fall back to provider instance execute() when stream() is absent",
    () => {
      class ExecHandler {
        execute(cmd: StreamCommand): number {
          return cmd.data * 10;
        }
      }

      const bus = new CommandBus({
        provider: (cmdType) =>
          cmdType === StreamCommand ? new ExecHandler() : undefined,
      });
      bus.register(StreamCommand);

      let result = 0;
      let done = false;
      bus.stream(new StreamCommand(5), (val, isDone) => {
        result = val;
        done = isDone;
      });
      assertEquals(result, 50);
      assertEquals(done, true);
    },
  );

  await t.step(
    "stream should delegate to provider instance streamAsync() generator when stream() is absent",
    async () => {
      class AsyncGenHandler {
        async *streamAsync(cmd: StreamCommand) {
          for (let i = 0; i < cmd.data; i++) {
            yield i * 3;
          }
        }
      }

      const bus = new CommandBus({
        provider: (cmdType) =>
          cmdType === StreamCommand ? new AsyncGenHandler() : undefined,
      });
      bus.register(StreamCommand);

      const results: number[] = [];
      await new Promise<void>((resolve, reject) => {
        bus.stream(new StreamCommand(3), (val, done, err) => {
          if (err) return reject(err);
          if (!done) results.push(val);
          if (done) resolve();
        });
      });
      assertEquals(results, [0, 3, 6]);
    },
  );

  await t.step(
    "waitFor should remove abort listener from signal on resolution to prevent leaks",
    async () => {
      const bus = new CommandBus();
      const ac = new AbortController();

      let listenersCount = 0;
      const originalAdd = ac.signal.addEventListener.bind(ac.signal);
      const originalRemove = ac.signal.removeEventListener.bind(ac.signal);

      ac.signal.addEventListener = ((type: string, listener: any, options: any) => {
        if (type === "abort") listenersCount++;
        return originalAdd(type, listener, options);
      }) as any;

      ac.signal.removeEventListener = ((type: string, listener: any, options: any) => {
        if (type === "abort") listenersCount--;
        return originalRemove(type, listener, options);
      }) as any;

      const promise = bus.waitFor(StreamCommand, { signal: ac.signal });
      assertEquals(listenersCount, 1);

      bus.register(StreamCommand, () => 42);
      await promise;

      assertEquals(listenersCount, 0);
    },
  );

  await t.step(
    "registerStream should support single-point registration without handler",
    () => {
      const bus = new CommandBus({
        provider: (cmdType) => {
          if (cmdType === StreamCommand) {
            return {
              stream: (
                cmd: StreamCommand,
                _ctx: any,
                next: (v: number, d: boolean) => void,
              ) => {
                next(cmd.data * 2, true);
              },
            };
          }
        },
      });

      bus.registerStream(StreamCommand);
      assertEquals(bus.isAvailable(StreamCommand), true);

      let result = 0;
      bus.stream(new StreamCommand(15), (v) => {
        result = v;
      });
      assertEquals(result, 30);
    },
  );
});

