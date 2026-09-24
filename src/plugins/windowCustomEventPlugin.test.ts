import { assertEquals, assertRejects } from "@std/assert";
import { AsyncCommandBus } from "../asyncCommandBus.ts";
import { Command } from "../commandModel.ts";
import {
  createWindowCustomEventMessageChannel,
  WindowCustomEventMessageChannel,
  WindowCustomEventPlugin,
  WindowCustomEventPort,
  windowCustomEventPlugin,
} from "./windowCustomEventPlugin.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AddCommand extends Command<{ a: number; b: number }, number> {}
class FailCommand extends Command<string, string> {}
class StreamNumbersCommand extends Command<number, number> {}

Deno.test("WindowCustomEventPort - send and receive messages", async () => {
  const target = new EventTarget();
  const port1 = new WindowCustomEventPort({ target, eventName: "cmd-port-test" });
  const port2 = new WindowCustomEventPort({ target, eventName: "cmd-port-test" });

  const received: any[] = [];
  port2.onmessage = (ev) => received.push(ev.data);

  port1.postMessage({ hello: "world" });
  await delay(10);

  assertEquals(received, [{ hello: "world" }]);

  port1.close();
  port2.close();
});

Deno.test("WindowCustomEventPort - does not receive own messages", async () => {
  const target = new EventTarget();
  const port = new WindowCustomEventPort({ target, eventName: "cmd-self-test" });

  const received: any[] = [];
  port.onmessage = (ev) => received.push(ev.data);

  port.postMessage("ping");
  await delay(10);

  assertEquals(received.length, 0);
  port.close();
});

Deno.test("WindowCustomEventMessageChannel - paired ports communication", async () => {
  const target = new EventTarget();
  const channel = new WindowCustomEventMessageChannel({
    target,
    eventName: "cmd-channel-test",
  });

  const received1: any[] = [];
  const received2: any[] = [];

  channel.port1.onmessage = (ev) => received1.push(ev.data);
  channel.port2.onmessage = (ev) => received2.push(ev.data);

  channel.port1.postMessage("from 1 to 2");
  channel.port2.postMessage("from 2 to 1");

  await delay(10);

  assertEquals(received1, ["from 2 to 1"]);
  assertEquals(received2, ["from 1 to 2"]);

  channel.port1.close();
  channel.port2.close();
});

Deno.test("WindowCustomEventPlugin - execute command across buses", async () => {
  const target = new EventTarget();
  const eventName = "cmd-bus-test-" + crypto.randomUUID();

  const plugin1 = new WindowCustomEventPlugin({
    target,
    eventName,
    id: "node1",
  });
  const plugin2 = new WindowCustomEventPlugin({
    target,
    eventName,
    id: "node2",
  });

  const bus1 = new AsyncCommandBus({ plugin: plugin1 });
  const bus2 = new AsyncCommandBus({ plugin: plugin2 });

  bus2.register(AddCommand, (cmd) => cmd.data.a + cmd.data.b);

  await delay(50);

  const result = await bus1.execute(new AddCommand({ a: 15, b: 27 }));
  assertEquals(result, 42);

  plugin1[Symbol.dispose]();
  plugin2[Symbol.dispose]();
});

Deno.test("WindowCustomEventPlugin - propagates command errors", async () => {
  const target = new EventTarget();
  const eventName = "cmd-bus-err-" + crypto.randomUUID();

  const plugin1 = new WindowCustomEventPlugin({
    target,
    eventName,
    id: "node1",
  });
  const plugin2 = new WindowCustomEventPlugin({
    target,
    eventName,
    id: "node2",
  });

  const bus1 = new AsyncCommandBus({ plugin: plugin1 });
  const bus2 = new AsyncCommandBus({ plugin: plugin2 });

  bus2.register(FailCommand, () => {
    throw "Intentional failure";
  });

  await delay(50);

  await assertRejects(
    () => bus1.execute(new FailCommand("boom")),
    "Intentional failure",
  );

  plugin1[Symbol.dispose]();
  plugin2[Symbol.dispose]();
});

Deno.test("WindowCustomEventPlugin - stream commands across buses", async () => {
  const target = new EventTarget();
  const eventName = "cmd-bus-stream-" + crypto.randomUUID();

  const plugin1 = windowCustomEventPlugin({
    target,
    eventName,
    id: "node1",
    bufferTimeout: 50,
  });
  const plugin2 = windowCustomEventPlugin({
    target,
    eventName,
    id: "node2",
    bufferTimeout: 50,
  });

  const bus1 = new AsyncCommandBus({ plugin: plugin1 });
  const bus2 = new AsyncCommandBus({ plugin: plugin2 });

  bus2.registerStream(StreamNumbersCommand, (cmd, _ctx, next) => {
    const limit = cmd.data;
    let count = 0;
    const interval = setInterval(() => {
      count++;
      next(count, count >= limit);
      if (count >= limit) {
        clearInterval(interval);
      }
    }, 20);

    return () => clearInterval(interval);
  });

  await delay(50);

  const values: number[] = [];
  await new Promise<void>((resolve) => {
    bus1.stream(new StreamNumbersCommand(3), (val: any, done: boolean) => {
      if (val !== null && val !== undefined) {
        values.push(val);
      }
      if (done) {
        resolve();
      }
    });
  });

  assertEquals(values, [1, 2, 3]);

  await delay(60);

  plugin1[Symbol.dispose]();
  plugin2[Symbol.dispose]();
});

Deno.test("WindowCustomEventPlugin - async generator stream commands", async () => {
  const target = new EventTarget();
  const eventName = "cmd-bus-asyncstream-" + crypto.randomUUID();

  const plugin1 = new WindowCustomEventPlugin({
    target,
    eventName,
    id: "node1",
  });
  const plugin2 = new WindowCustomEventPlugin({
    target,
    eventName,
    id: "node2",
  });

  const bus1 = new AsyncCommandBus({ plugin: plugin1 });
  const bus2 = new AsyncCommandBus({ plugin: plugin2 });

  bus2.registerStreamAsync(StreamNumbersCommand, async function* (cmd) {
    for (let i = 1; i <= cmd.data; i++) {
      yield i;
    }
  });

  await delay(50);

  const values: number[] = [];
  await new Promise<void>((resolve) => {
    bus1.stream(new StreamNumbersCommand(3), (val: any, done: boolean) => {
      if (val !== null && val !== undefined) {
        values.push(val);
      }
      if (done) {
        resolve();
      }
    });
  });

  assertEquals(values, [1, 2, 3]);

  plugin1[Symbol.dispose]();
  plugin2[Symbol.dispose]();
});

Deno.test("createWindowCustomEventMessageChannel factory creates paired channel", () => {
  const target = new EventTarget();
  const channel = createWindowCustomEventMessageChannel({ target });
  assertEquals(channel.port1.peerId, channel.port2.id);
  assertEquals(channel.port2.peerId, channel.port1.id);
  channel.port1.close();
  channel.port2.close();
});

Deno.test("WindowCustomEventPort - createBridge attaches port to plugin", () => {
  const target = new EventTarget();
  const plugin = new WindowCustomEventPlugin({ target, eventName: "bridge-test" });

  const bridge = WindowCustomEventPort.createBridge(plugin, {
    target,
    eventName: "bridge-sub",
  });

  assertEquals(plugin.ports.has(bridge.port), true);
  bridge.disconnect();
  assertEquals(bridge.port.closed, true);
  plugin[Symbol.dispose]();
});
