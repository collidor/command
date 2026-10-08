import type { MessagePortLike } from "@collidor/event";
import { PortChannelPlugin } from "./portChannelPlugin.ts";

import { assert, assertEquals, assertRejects } from "@std/assert";
import { Command } from "../commandModel.ts";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { AsyncCommandBus } from "../asyncCommandBus.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectPorts(...ports: FakeMessagePort[]) {
  for (const port of ports) {
    port.postMessage = function (this: FakeMessagePort, message: any) {
      this.messages.push(message);
      this.sentMessages.push(
        typeof message === "string" ? JSON.parse(message) : message,
      );

      for (const p of ports) {
        if (p === port) continue;
        p.receivedMessages.push(JSON.parse(message));
        p.onmessage?.({ data: message, currentTarget: p });
      }
    };
  }
}

function getNodes<const N extends number>(n: N):
  & Array<{
    port: FakeMessagePort;
    portChannelPlugin: PortChannelPlugin;
    commandBus: AsyncCommandBus<any, PortChannelPlugin>;
  }>
  & { length: N } {
  const ret = [] as any[] as
    & Array<{
      port: FakeMessagePort;
      portChannelPlugin: PortChannelPlugin;
      commandBus: AsyncCommandBus<any, PortChannelPlugin>;
    }>
    & { length: N };

  for (let i = 0; i < n; i++) {
    const port = new FakeMessagePort(i + "");
    const portChannelPlugin = new PortChannelPlugin();
    portChannelPlugin.addPort(port);
    const commandBus = new AsyncCommandBus({
      plugin: portChannelPlugin,
    });
    ret[i] = {
      port,
      portChannelPlugin,
      commandBus,
    };
  }

  connectPorts(...ret.map((v) => v.port));

  return ret;
}

// A simple FakeMessagePort that implements MessagePortLike for testing.
class FakeMessagePort implements MessagePortLike {
  public messages: any[] = [];
  public receivedMessages: any[] = [];
  public sentMessages: any[] = [];

  public onmessage: ((ev: any) => void) | null = null;
  public onmessageerror: ((ev: MessageEvent) => void) | null = null;

  constructor(public name = "FakeMessagePort") {}

  postMessage(message: any): void {
    this.messages.push(
      typeof message === "string" ? JSON.parse(message) : message,
    );
  }
  start(): void {}
}

class ExampleCommand extends Command<number, number> {}

Deno.test("PortChannelPlugin - install CommandBus", () => {
  const portChannelPlugin = new PortChannelPlugin();
  const fakePort = new FakeMessagePort();
  portChannelPlugin.addPort(fakePort);
  const context = { test: "test" };
  const commandBus = new AsyncCommandBus({
    context,
    plugin: portChannelPlugin,
  });

  assertEquals(portChannelPlugin["commandBus"], commandBus);
  assertEquals(portChannelPlugin.context, context);
});

Deno.test("PortChannelPlugin - send command", async () => {
  const nodes = getNodes(2);

  nodes[0].commandBus.register(ExampleCommand, (command) => command.data * 2);

  const command = new ExampleCommand(42);
  const promise = nodes[1].commandBus.execute(command);

  assertEquals(await promise, 84);
});

Deno.test("PortChannelPlugin - send command with error", () => {
  const nodes = getNodes(2);

  nodes[0].commandBus.register(ExampleCommand, () => {
    throw "error";
  });

  const command = new ExampleCommand(42);

  assertRejects(() => nodes[1].commandBus.execute(command), "error");
});

Deno.test("PortChannelPlugin - command times out", async () => {
  const port = new FakeMessagePort();
  const portChannelPlugin = new PortChannelPlugin({
    commandTimeout: 200,
    bufferTimeout: 50,
  });
  portChannelPlugin.addPort(port);
  const commandBus = new AsyncCommandBus({
    plugin: portChannelPlugin,
  });
  port.onmessage?.({
    data: JSON.stringify({
      name: "ExampleCommand",
      type: "subscribeEvent",
    }),
  });
  const promise = commandBus.execute(new ExampleCommand(42)).catch((e) => e);

  await sleep(1000);

  assert((await promise).message.includes("Timeout"));
});

Deno.test("PortChannelPlugin - use local streamHandler if available", async () => {
  const nodes = getNodes(2);

  const spy1 = spy();
  nodes[0].commandBus.registerStream(
    ExampleCommand,
    (_command, _context, next) => {
      next(1, true);
      spy1(1);
      return () => {};
    },
  );

  const spy2 = spy();

  nodes[1].commandBus.registerStream(
    ExampleCommand,
    (_command, _context, next) => {
      next(2, true);
      spy2(2);
      return () => {};
    },
  );

  const command = new ExampleCommand(42);
  const promise = new Promise((resolve) => {
    return nodes[0].commandBus.stream(command, (data) => {
      resolve(data);
    });
  });

  assertEquals(await promise, 1);
  assertSpyCalls(spy1, 1);
  assertSpyCalls(spy2, 0);
});

Deno.test("PortChannelPlugin - use local asyncStreamHandler if available", async () => {
  const nodes = getNodes(2);

  const spy1 = spy();
  nodes[0].commandBus.registerStreamAsync(ExampleCommand, async function* () {
    spy1(1);
    yield 1;
  });

  const spy2 = spy();

  nodes[1].commandBus.registerStreamAsync(ExampleCommand, async function* () {
    spy2(2);
    yield 2;
  });

  const command = new ExampleCommand(42);
  const promise = new Promise((resolve) =>
    nodes[0].commandBus.stream(command, (data) => {
      resolve(data);
    })
  );

  assertEquals(await promise, 1);
  assertSpyCalls(spy1, 1);
  assertSpyCalls(spy2, 0);
});

Deno.test("PortChannelPlugin - use local handler if available", async () => {
  const portChannelPlugin = new PortChannelPlugin();
  const fakePort = new FakeMessagePort();
  portChannelPlugin.addPort(fakePort);
  const commandBus = new AsyncCommandBus({
    plugin: portChannelPlugin,
  });

  commandBus.register(ExampleCommand, (command) => {
    return command.data + 1;
  });

  const command = new ExampleCommand(42);
  const promise = commandBus.execute(command);

  assertEquals(await promise, 43);
});

Deno.test("PortChannelPlugin - multiple clients can execute the same stream command", async () => {
  const nodes = getNodes(2);

  nodes[0].commandBus.registerStream(
    ExampleCommand,
    (command, _context, next) => {
      next(command.data * 2, false);
      setTimeout(() => {
        next(command.data * 3, false);
      }, 100);
      return () => {};
    },
  );
  const callback1 = spy();
  const callback2 = spy();

  nodes[1].commandBus.stream(new ExampleCommand(1), callback1);
  nodes[1].commandBus.stream(new ExampleCommand(2), callback2);

  await sleep(2000);

  assertSpyCalls(callback1, 2);
  assertSpyCalls(callback2, 2);

  assertEquals(callback1.calls[0].args[0], 2);
  assertEquals(callback1.calls[1].args[0], 3);

  assertEquals(callback2.calls[0].args[0], 4);
  assertEquals(callback2.calls[1].args[0], 6);
});

Deno.test("PortChannelPlugin - multiple clients can execute the same async stream command", async () => {
  const nodes = getNodes(2);

  nodes[0].commandBus.registerStreamAsync(ExampleCommand, async function* (
    command,
    _context,
  ) {
    yield command.data * 2;
    await sleep(100);
    yield command.data * 3;
  });

  const callback1 = spy();
  const callback2 = spy();

  nodes[1].commandBus.stream(new ExampleCommand(1), callback1);
  nodes[1].commandBus.stream(new ExampleCommand(2), callback2);

  await sleep(2000);

  assertSpyCalls(callback1, 3);
  assertSpyCalls(callback2, 3);

  assertEquals(callback1.calls[0].args[0], 2);
  assertEquals(callback1.calls[1].args[0], 3);

  assertEquals(callback2.calls[0].args[0], 4);
  assertEquals(callback2.calls[1].args[0], 6);
});

Deno.test("PortChannelPlubin - should stop if unsubscribe is called", async () => {
  const nodes = getNodes(2);

  nodes[0].commandBus.registerStream(
    ExampleCommand,
    (command, _context, next) => {
      let stop = false;
      const timeouts: any[] = [];
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
  const unsubscribe = nodes[1].commandBus.stream(
    new ExampleCommand(42),
    (data) => {
      result.push(data);
      unsubscribe();
    },
  );

  await sleep(500);

  assertEquals(result, [0]);
});

Deno.test("PortChannelPlugin - cleans up ack listeners and response subscriptions after execution", async () => {
  const nodes = getNodes(2);
  nodes[0].commandBus.register(ExampleCommand, (cmd) => cmd.data * 2);

  const res = await nodes[1].commandBus.execute(new ExampleCommand(21));
  assertEquals(res, 42);

  // Verify ackName listeners are empty
  const ackName = "ExampleCommand_Ack";
  const ackListeners = nodes[1].portChannelPlugin.listeners.get(ackName) ?? [];
  assertEquals(ackListeners.length, 0);

  // Verify responseSubscriptions has no leftover entries
  const responseName = "ExampleCommand_Response";
  assertEquals(
    nodes[1].portChannelPlugin["responseSubscriptions"].has(responseName),
    false,
  );
});

Deno.test("PortChannelPlugin - fails over to next candidate when first candidate fails to ACK", async () => {
  const nodes = getNodes(3);
  nodes[2].portChannelPlugin["ackTimeout"] = 100;

  // Node 1 is a healthy candidate
  nodes[1].commandBus.register(ExampleCommand, (cmd) => cmd.data * 10);

  // Inject a silent candidate ahead of Node 1 in sourceSubscriptions
  const silentCandidateId = "silent-dead-node";
  // Map silent candidate to a port so publish can attempt delivery
  nodes[2].portChannelPlugin.idPorts.set(
    silentCandidateId,
    new Map([[nodes[0].port, 1]]),
  );
  nodes[2].portChannelPlugin.sourceSubscriptions.set(
    "ExampleCommand",
    new Set([silentCandidateId, nodes[1].portChannelPlugin.id]),
  );

  const start = Date.now();
  const result = await nodes[2].commandBus.execute(new ExampleCommand(7));
  const duration = Date.now() - start;

  assertEquals(result, 70);
  // Failover waited ~100ms for silent candidate, then immediately succeeded with Node 1
  assert(duration >= 90, `Expected duration >= 90ms, got ${duration}ms`);
  assert(duration < 1000, `Expected duration < 1000ms, got ${duration}ms`);
});

Deno.test("PortChannelPlugin - remote command availability via register and unregister", () => {
  const nodes = getNodes(2);

  assertEquals(nodes[0].commandBus.isAvailable(ExampleCommand), false);
  assertEquals(nodes[0].commandBus.getAvailableCommands(), []);

  const transitions: boolean[] = [];
  nodes[0].commandBus.onAvailabilityChange(ExampleCommand, (avail) => {
    transitions.push(avail);
  }, { immediate: true });

  assertEquals(transitions, [false]);

  // Node 1 registers the command
  nodes[1].commandBus.register(ExampleCommand, (cmd) => cmd.data * 2);

  assertEquals(nodes[0].commandBus.isAvailable(ExampleCommand), true);
  assertEquals(nodes[0].commandBus.getAvailableCommands(), ["ExampleCommand"]);
  assertEquals(transitions, [false, true]);

  // Node 1 unregisters the command
  nodes[1].commandBus.unregister(ExampleCommand);

  assertEquals(nodes[0].commandBus.isAvailable(ExampleCommand), false);
  assertEquals(nodes[0].commandBus.getAvailableCommands(), []);
  assertEquals(transitions, [false, true, false]);
});

Deno.test("PortChannelPlugin - remote command availability on peer disconnect", () => {
  const nodes = getNodes(2);

  nodes[1].commandBus.register(ExampleCommand, (cmd) => cmd.data * 2);
  assertEquals(nodes[0].commandBus.isAvailable(ExampleCommand), true);

  const transitions: boolean[] = [];
  nodes[0].commandBus.onAvailabilityChange(ExampleCommand, (avail) => {
    transitions.push(avail);
  }, { immediate: false });

  // Simulate peer 1 disconnect on peer 0
  nodes[0].portChannelPlugin.removePort(nodes[0].port, nodes[1].portChannelPlugin.id);

  assertEquals(nodes[0].commandBus.isAvailable(ExampleCommand), false);
  assertEquals(transitions, [false]);
});

Deno.test("PortChannelPlugin - multi-peer redundancy preserves availability until last peer leaves", () => {
  const nodes = getNodes(3);

  // Both Node 1 and Node 2 register ExampleCommand
  nodes[1].commandBus.register(ExampleCommand, (cmd) => cmd.data * 2);
  nodes[2].commandBus.register(ExampleCommand, (cmd) => cmd.data * 3);

  assertEquals(nodes[0].commandBus.isAvailable(ExampleCommand), true);

  const transitions: boolean[] = [];
  nodes[0].commandBus.onAvailabilityChange(ExampleCommand, (avail) => {
    transitions.push(avail);
  }, { immediate: false });

  // Node 1 disconnects - Node 2 is still providing ExampleCommand
  nodes[0].portChannelPlugin.removePort(nodes[0].port, nodes[1].portChannelPlugin.id);
  assertEquals(nodes[0].commandBus.isAvailable(ExampleCommand), true);
  assertEquals(transitions.length, 0); // No false drop!

  // Node 2 unregisters ExampleCommand
  nodes[2].commandBus.unregister(ExampleCommand);
  assertEquals(nodes[0].commandBus.isAvailable(ExampleCommand), false);
  assertEquals(transitions, [false]);
});

Deno.test("PortChannelPlugin - waitFor remote command across peers", async () => {
  const nodes = getNodes(2);
  let resolved = false;

  const waitPromise = nodes[0].commandBus.waitFor(ExampleCommand).then(() => {
    resolved = true;
  });

  assertEquals(resolved, false);
  await sleep(10);
  assertEquals(resolved, false);

  // Node 1 registers ExampleCommand
  nodes[1].commandBus.register(ExampleCommand, (cmd) => cmd.data * 5);
  await waitPromise;
  assertEquals(resolved, true);

  // Node 0 can now execute it
  const result = await nodes[0].commandBus.execute(new ExampleCommand(7));
  assertEquals(result, 35);
});

Deno.test(
  "PortChannelPlugin - execute remote command resolved via DI provider on worker node",
  async () => {
    const nodes = getNodes(2);

    class ExampleCommandHandler {
      execute(cmd: ExampleCommand): number {
        return cmd.data * 3;
      }
    }

    // Node 1 configures DI provider and registers ExampleCommand without inline handler
    nodes[1].commandBus.setProvider((cmdType) => {
      if (cmdType === ExampleCommand) {
        return new ExampleCommandHandler();
      }
    });
    nodes[1].commandBus.register(ExampleCommand);

    // Node 0 executes ExampleCommand across port channel
    const result = await nodes[0].commandBus.execute(new ExampleCommand(10));
    assertEquals(result, 30);
  },
);

Deno.test(
  "PortChannelPlugin - use local handler via DI provider if available",
  async () => {
    const portChannelPlugin = new PortChannelPlugin();
    const fakePort = new FakeMessagePort();
    portChannelPlugin.addPort(fakePort);

    class LocalHandler {
      execute(cmd: ExampleCommand): number {
        return cmd.data + 100;
      }
    }

    const commandBus = new AsyncCommandBus({
      plugin: portChannelPlugin,
      provider: (cmdType) =>
        cmdType === ExampleCommand ? new LocalHandler() : undefined,
    });

    commandBus.register(ExampleCommand);

    const result = await commandBus.execute(new ExampleCommand(25));
    assertEquals(result, 125);
  },
);

Deno.test(
  "PortChannelPlugin - use local stream via DI provider if available",
  async () => {
    const portChannelPlugin = new PortChannelPlugin();
    const fakePort = new FakeMessagePort();
    portChannelPlugin.addPort(fakePort);

    class LocalStreamHandler {
      async *streamAsync(cmd: ExampleCommand) {
        for (let i = 0; i < cmd.data; i++) {
          yield i * 2;
        }
      }
    }

    const commandBus = new AsyncCommandBus({
      plugin: portChannelPlugin,
      provider: (cmdType) =>
        cmdType === ExampleCommand ? new LocalStreamHandler() : undefined,
    });

    commandBus.register(ExampleCommand);

    const results: number[] = [];
    await new Promise<void>((resolve, reject) => {
      commandBus.stream(new ExampleCommand(3), (data, done, err) => {
        if (err) return reject(err);
        if (!done) results.push(data);
        if (done) resolve();
      });
    });

    assertEquals(results, [0, 2, 4]);
  },
);

Deno.test(
  "PortChannelPlugin - execute remote stream resolved via DI provider on worker node",
  async () => {
    const nodes = getNodes(2);

    class ExampleStreamHandler {
      async *streamAsync(cmd: ExampleCommand) {
        for (let i = 0; i < cmd.data; i++) {
          yield i * 5;
        }
      }
    }

    nodes[1].commandBus.setProvider((cmdType) => {
      if (cmdType === ExampleCommand) {
        return new ExampleStreamHandler();
      }
    });
    nodes[1].commandBus.registerStream(ExampleCommand);

    const results: number[] = [];
    await new Promise<void>((resolve, reject) => {
      nodes[0].commandBus.stream(new ExampleCommand(3), (data, done, err) => {
        if (err) return reject(err);
        if (!done) results.push(data);
        if (done) resolve();
      });
    });

    assertEquals(results, [0, 5, 10]);
  },
);



function listenerCount(plugin: PortChannelPlugin, name: string): number {
  return (plugin as any).listeners.get(name)?.length ?? 0;
}

Deno.test("PortChannelPlugin - a throwing async stream handler reports an error to the remote caller", async () => {
  const nodes = getNodes(2);

  nodes[0].commandBus.registerStreamAsync(ExampleCommand, async function* () {
    yield 1;
    throw new Error("generator failed");
  });

  const frames: Array<{ data: any; done: boolean; error?: any }> = [];
  nodes[1].commandBus.stream(new ExampleCommand(1), (data, done, error) => {
    frames.push({ data, done, error });
  });

  await sleep(50);

  assertEquals(frames[0].data, 1);
  const last = frames[frames.length - 1];
  assertEquals(last.done, true);
  assert(last.error !== undefined);
});

Deno.test("PortChannelPlugin - an async stream handler that throws synchronously reports an error", async () => {
  const nodes = getNodes(2);

  nodes[0].commandBus.registerStreamAsync(ExampleCommand, (() => {
    throw new Error("sync failure");
  }) as any);

  const frames: Array<{ done: boolean; error?: any }> = [];
  nodes[1].commandBus.stream(new ExampleCommand(1), (_d, done, error) => {
    frames.push({ done, error });
  });

  await sleep(50);
  assertEquals(frames.length, 1);
  assertEquals(frames[0].done, true);
  assert(frames[0].error !== undefined);
});

Deno.test("PortChannelPlugin - a sync stream handler that throws reports an error to the remote caller", async () => {
  const nodes = getNodes(2);

  nodes[0].commandBus.registerStream(ExampleCommand, () => {
    throw new Error("stream setup failed");
  });

  const frames: Array<{ done: boolean; error?: any }> = [];
  nodes[1].commandBus.stream(new ExampleCommand(1), (_d, done, error) => {
    frames.push({ done, error });
  });

  await sleep(50);
  assertEquals(frames.length, 1);
  assertEquals(frames[0].done, true);
  assert(frames[0].error !== undefined);
});

Deno.test("PortChannelPlugin - stream requests do not accumulate unsubscribe listeners", async () => {
  const nodes = getNodes(2);

  nodes[0].commandBus.registerStream(ExampleCommand, (cmd, _ctx, next) => {
    next(cmd.data, true);
    return () => {};
  });

  const before = listenerCount(nodes[0].portChannelPlugin, "ExampleCommand_Unsubscribe");
  for (let i = 0; i < 5; i++) {
    nodes[1].commandBus.stream(new ExampleCommand(i), () => {});
  }
  await sleep(50);

  assertEquals(
    listenerCount(nodes[0].portChannelPlugin, "ExampleCommand_Unsubscribe"),
    before,
  );
});

Deno.test("PortChannelPlugin - unregister removes async stream subscriptions", async () => {
  const nodes = getNodes(2);

  nodes[0].commandBus.registerStreamAsync(ExampleCommand, async function* () {
    yield 1;
  });
  const plugin = nodes[0].portChannelPlugin;
  assertEquals(listenerCount(plugin, "ExampleCommand"), 1);
  assertEquals(listenerCount(plugin, "ExampleCommand_Unsubscribe"), 1);

  nodes[0].commandBus.unregister(ExampleCommand);
  await sleep(10);

  assertEquals(listenerCount(plugin, "ExampleCommand"), 0);
  assertEquals(listenerCount(plugin, "ExampleCommand_Unsubscribe"), 0);
});

Deno.test("PortChannelPlugin - registering a command twice does not duplicate handling", async () => {
  const nodes = getNodes(2);
  const first = spy((c: ExampleCommand) => c.data);
  const second = spy((c: ExampleCommand) => c.data * 2);

  nodes[0].commandBus.register(ExampleCommand, first);
  nodes[0].commandBus.register(ExampleCommand, second);

  assertEquals(listenerCount(nodes[0].portChannelPlugin, "ExampleCommand"), 1);
  assertEquals(await nodes[1].commandBus.execute(new ExampleCommand(2)), 4);
  assertSpyCalls(first, 0);
  assertSpyCalls(second, 1);
});

Deno.test("PortChannelPlugin - unregister with a command instance removes the subscription", () => {
  const nodes = getNodes(2);
  nodes[0].commandBus.register(ExampleCommand, (c) => c.data);
  assertEquals(listenerCount(nodes[0].portChannelPlugin, "ExampleCommand"), 1);

  nodes[0].commandBus.unregister(new ExampleCommand(1));
  assertEquals(listenerCount(nodes[0].portChannelPlugin, "ExampleCommand"), 0);
});

Deno.test("PortChannelPlugin - a remote async stream accepts a plain AsyncIterable", async () => {
  const nodes = getNodes(2);

  nodes[0].commandBus.registerStreamAsync(ExampleCommand, () => ({
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () =>
          Promise.resolve(
            i < 2 ? { value: i++, done: false } : { value: undefined, done: true },
          ),
      };
    },
  }) as any);

  const got: number[] = [];
  let done = false;
  nodes[1].commandBus.stream(new ExampleCommand(1), (d, isDone) => {
    if (!isDone) got.push(d);
    else done = true;
  });

  await sleep(50);
  assertEquals(got, [0, 1]);
  assertEquals(done, true);
});

Deno.test("PortChannelPlugin - unregister ends an in-flight async stream with a done frame", async () => {
  const nodes = getNodes(2);

  nodes[0].commandBus.registerStreamAsync(ExampleCommand, async function* () {
    let i = 0;
    while (true) {
      yield i++;
      await sleep(5);
    }
  });

  const frames: Array<{ done: boolean; error?: any }> = [];
  nodes[1].commandBus.stream(new ExampleCommand(1), (_d, done, error) => {
    frames.push({ done, error });
  });
  await sleep(30);

  nodes[0].commandBus.unregister(ExampleCommand);
  await sleep(30);

  assert(frames.some((f) => f.done), "consumer never received a done frame");
});

Deno.test("PortChannelPlugin - unregister ends an in-flight callback stream with a done frame", async () => {
  const nodes = getNodes(2);

  nodes[0].commandBus.registerStream(ExampleCommand, (_c, _x, next) => {
    next(1, false);
    return () => {};
  });

  const frames: Array<{ done: boolean; error?: any }> = [];
  nodes[1].commandBus.stream(new ExampleCommand(1), (_d, done, error) => {
    frames.push({ done, error });
  });
  await sleep(30);

  nodes[0].commandBus.unregister(ExampleCommand);
  await sleep(30);

  assert(frames.some((f) => f.done), "consumer never received a done frame");
});
