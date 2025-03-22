import type { MessagePortLike } from "@collidor/event";
import { PortChannelPlugin } from "./portChannelPlugin.ts";
import { CommandBus } from "../commandBus.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Command } from "../commandModel.ts";
import { assertSpyCalls, spy } from "@std/testing/mock";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectPorts(...ports: FakeMessagePort[]) {
  for (const port of ports) {
    port.postMessage = function (this: FakeMessagePort, message: any) {
      this.messages.push(message);

      for (const p of ports) {
        if (p === port) continue;
        p.onmessage?.({ data: message, currentTarget: p });
      }
    };
  }
}

function getNodes<const N extends number>(n: N):
  & Array<{
    port: FakeMessagePort;
    portChannelPlugin: PortChannelPlugin;
    commandBus: CommandBus<any, PortChannelPlugin>;
  }>
  & { length: N } {
  const ret = [] as any[] as
    & Array<{
      port: FakeMessagePort;
      portChannelPlugin: PortChannelPlugin;
      commandBus: CommandBus<any, PortChannelPlugin>;
    }>
    & { length: N };

  for (let i = 0; i < n; i++) {
    const port = new FakeMessagePort(i + "");
    const portChannelPlugin = new PortChannelPlugin();
    portChannelPlugin.addPort(port);
    const commandBus = new CommandBus({
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
  const commandBus = new CommandBus({
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

Deno.test("PortChannelPlugin - send command with error", async () => {
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
  const commandBus = new CommandBus({
    plugin: portChannelPlugin,
  });
  port.onmessage?.({
    data: JSON.stringify({
      name: "ExampleCommand",
      type: "subscribeEvent",
    }),
  });
  const promise = commandBus.execute(new ExampleCommand(42)).catch((e) => e);

  await delay(1000);

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
  const promise = new Promise((resolve) =>
    nodes[0].commandBus.stream(command, (data) => {
      resolve(data);
    })
  );

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
  const commandBus = new CommandBus({
    plugin: portChannelPlugin,
  });

  commandBus.register(ExampleCommand, (command) => {
    return command.data + 1;
  });

  const command = new ExampleCommand(42);
  const promise = commandBus.execute(command);

  assertEquals(await promise, 43);
});
