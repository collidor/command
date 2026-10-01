import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { Command } from "./commandModel.ts";
import { CommandBus } from "./commandBus.ts";
import { AsyncCommandBus } from "./asyncCommandBus.ts";
import { createCommand } from "./createCommand.ts";

Deno.test("createCommand - Basic Creation and Naming", async (t) => {
  await t.step("should create a command class with explicit name", () => {
    const CustomCommand = createCommand<{ message: string }, string>(
      "CustomCommand",
    );

    assertEquals(CustomCommand.name, "CustomCommand");

    const cmd = new CustomCommand({ message: "hello" });
    assertEquals(cmd.constructor.name, "CustomCommand");
    assertEquals(cmd.data, { message: "hello" });
    assertInstanceOf(cmd, Command);
    assertInstanceOf(cmd, CustomCommand);
  });

  await t.step("should support void payload commands without arguments", () => {
    const PingCommand = createCommand<void, string>("PingCommand");

    assertEquals(PingCommand.name, "PingCommand");

    const cmd = new PingCommand();
    assertEquals(cmd.constructor.name, "PingCommand");
    assertEquals(cmd.data, undefined);
    assertInstanceOf(cmd, Command);
    assertInstanceOf(cmd, PingCommand);
  });

  await t.step("should support primitive payloads", () => {
    const CountCommand = createCommand<number, number>("CountCommand");
    const cmd = new CountCommand(42);

    assertEquals(cmd.data, 42);
    assertEquals(cmd.constructor.name, "CountCommand");
  });

  await t.step("should support default untyped commands", () => {
    const AnyCommand = createCommand("AnyCommand");
    const cmd1 = new AnyCommand();
    const cmd2 = new AnyCommand({ foo: "bar" });

    assertEquals(cmd1.data, undefined);
    assertEquals(cmd2.data, { foo: "bar" });
    assertEquals(cmd1.constructor.name, "AnyCommand");
    assertEquals(cmd2.constructor.name, "AnyCommand");
  });
});

Deno.test("createCommand - Name Validation", async (t) => {
  await t.step("should throw TypeError for empty or whitespace name", () => {
    assertThrows(
      () => createCommand(""),
      TypeError,
      "Command name must be a non-empty string",
    );
    assertThrows(
      () => createCommand("   "),
      TypeError,
      "Command name must be a non-empty string",
    );
  });

  await t.step("should throw TypeError for non-string names", () => {
    assertThrows(
      () => createCommand(null as any),
      TypeError,
      "Command name must be a non-empty string",
    );
    assertThrows(
      () => createCommand(undefined as any),
      TypeError,
      "Command name must be a non-empty string",
    );
    assertThrows(
      () => createCommand(123 as any),
      TypeError,
      "Command name must be a non-empty string",
    );
  });
});

Deno.test("createCommand - Bundler Minification Resilience", async (t) => {
  await t.step(
    "should preserve class name even if variable name is mangled",
    () => {
      // Simulating a bundler renaming variable `UserLoginCommand` to `a`
      const a = createCommand<{ user: string }, boolean>("UserLoginCommand");

      assertEquals(a.name, "UserLoginCommand");

      const instance = new a({ user: "admin" });
      assertEquals(instance.constructor.name, "UserLoginCommand");
    },
  );
});

Deno.test("createCommand - Sync CommandBus Integration", async (t) => {
  const GreetCommand = createCommand<{ name: string }, string>("GreetCommand");

  await t.step("should register and execute on CommandBus", () => {
    const bus = new CommandBus();
    bus.register(GreetCommand, (cmd) => `Hello, ${cmd.data.name}!`);

    const result = bus.execute(new GreetCommand({ name: "World" }));
    assertEquals(result, "Hello, World!");
  });

  await t.step("should check availability using constructor and string name", () => {
    const bus = new CommandBus();
    assertEquals(bus.isAvailable(GreetCommand), false);
    assertEquals(bus.isAvailable("GreetCommand"), false);

    bus.register(GreetCommand, (cmd) => cmd.data.name);

    assertEquals(bus.isAvailable(GreetCommand), true);
    assertEquals(bus.isAvailable("GreetCommand"), true);
    assertEquals(bus.getAvailableCommands().includes("GreetCommand"), true);

    bus.unregister(GreetCommand);
    assertEquals(bus.isAvailable(GreetCommand), false);
    assertEquals(bus.isAvailable("GreetCommand"), false);
  });

  await t.step("should support waitFor with createCommand class", async () => {
    const bus = new CommandBus();
    const waitPromise = bus.waitFor(GreetCommand);

    bus.register(GreetCommand, (cmd) => cmd.data.name);
    await waitPromise;
    assertEquals(bus.isAvailable(GreetCommand), true);
  });

  await t.step("should support callback streaming", () => {
    const StreamCmd = createCommand<number, number>("StreamCmd");
    const bus = new CommandBus();

    bus.registerStream(StreamCmd, (cmd, _ctx, next) => {
      for (let i = 0; i < cmd.data; i++) {
        next(i, i === cmd.data - 1);
      }
      return () => {};
    });

    const received: number[] = [];
    bus.stream(new StreamCmd(3), (data) => {
      received.push(data);
    });

    assertEquals(received, [0, 1, 2]);
  });
});

Deno.test("createCommand - AsyncCommandBus Integration", async (t) => {
  const AsyncAddCommand = createCommand<{ a: number; b: number }, number>(
    "AsyncAddCommand",
  );

  await t.step("should register and execute async handler", async () => {
    const bus = new AsyncCommandBus();
    bus.register(AsyncAddCommand, async (cmd) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return cmd.data.a + cmd.data.b;
    });

    const result = await bus.execute(new AsyncAddCommand({ a: 10, b: 20 }));
    assertEquals(result, 30);
  });

  await t.step("should support async stream generators", async () => {
    const AsyncGenCommand = createCommand<number, string>("AsyncGenCommand");
    const bus = new AsyncCommandBus();

    bus.registerStreamAsync(AsyncGenCommand, async function* (cmd) {
      for (let i = 0; i < cmd.data; i++) {
        yield `step-${i}`;
      }
    });

    const results: string[] = [];
    for await (const val of bus.streamAsync(new AsyncGenCommand(3))) {
      results.push(val);
    }

    assertEquals(results, ["step-0", "step-1", "step-2"]);
  });
});

Deno.test("createCommand - DI Provider & Single-Point Registration", async (t) => {
  const Cmd1 = createCommand<number, number>("ProviderCmd1");
  const Cmd2 = createCommand<string, string>("ProviderCmd2");

  await t.step("should resolve handler via DI provider", () => {
    const bus = new CommandBus({
      provider: (cmdConstructor) => {
        if (cmdConstructor === Cmd1) {
          return {
            execute: (cmd: any) => cmd.data * 10,
          };
        }
        if (cmdConstructor === Cmd2) {
          return (cmd: any) => `Echo: ${cmd.data}`;
        }
        return undefined;
      },
    });

    // Single-point registration
    bus.register([Cmd1, Cmd2]);

    assertEquals(bus.execute(new Cmd1(5)), 50);
    assertEquals(bus.execute(new Cmd2("hello")), "Echo: hello");
  });
});

Deno.test("createCommand - Subclassing", async (t) => {
  await t.step("should allow extending the returned command class", () => {
    const Base = createCommand<{ code: number }, boolean>("BaseCommand");

    class ChildCommand extends Base {
      public extra = "extra_field";
    }

    const child = new ChildCommand({ code: 200 });
    assertEquals(child.data, { code: 200 });
    assertEquals(child.extra, "extra_field");
    assertInstanceOf(child, Base);
    assertInstanceOf(child, Command);
  });
});
