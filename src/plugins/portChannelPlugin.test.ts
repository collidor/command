import type { MessagePortLike } from "@collidor/event";
import { PortChannelPlugin } from "./portChannelPlugin.ts";
import { CommandBus } from "../commandBus.ts";
import { assert, assertEquals } from "@std/assert";
import { Command } from "../commandModel.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A simple FakeMessagePort that implements MessagePortLike for testing.
class FakeMessagePort implements MessagePortLike {
  public messages: any[] = [];
  public onmessage: ((ev: any) => void) | null = null;
  public onmessageerror: ((ev: MessageEvent) => void) | null = null;

  postMessage(message: any): void {
    this.messages.push(message);
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
  const portChannelPlugin = new PortChannelPlugin();
  const fakePort = new FakeMessagePort();
  portChannelPlugin.addPort(fakePort);
  const commandBus = new CommandBus({
    plugin: portChannelPlugin,
  });

  fakePort.onmessage?.({
    data: {
      name: "ExampleCommand",
      type: "subscribeEvent",
    },
  });

  const command = new ExampleCommand(42);
  const promise = commandBus.execute(command);

  const dataMessage = JSON.parse(
    fakePort.messages.find((m) => m.type === "dataEvent").data,
  );

  fakePort.onmessage?.({
    data: {
      type: "dataEvent",
      name: "ExampleCommand_Response",
      data: JSON.stringify({
        id: dataMessage.id,
        data: 43,
        done: true,
      }),
    },
  });
  await delay(10);

  assertEquals(await promise, 43);
});

Deno.test("PortChannelPlugin - send command with error", async () => {
  const portChannelPlugin = new PortChannelPlugin();
  const fakePort = new FakeMessagePort();
  portChannelPlugin.addPort(fakePort);
  const commandBus = new CommandBus({
    plugin: portChannelPlugin,
  });

  fakePort.onmessage?.({
    data: {
      name: "ExampleCommand",
      type: "subscribeEvent",
    },
  });

  const command = new ExampleCommand(42);
  const promise = commandBus.execute(command).catch((e) => e);

  const dataMessage = JSON.parse(
    fakePort.messages.find((m) => m.type === "dataEvent").data,
  );

  fakePort.onmessage?.({
    data: {
      type: "dataEvent",
      name: "ExampleCommand_Response",
      data: JSON.stringify({
        id: dataMessage.id,
        error: "error",
        done: true,
      }),
    },
  });
  await delay(10);

  assert(await promise === "error");
});

Deno.test("PortChannelPlugin - command times out", async () => {
  const portChannelPlugin = new PortChannelPlugin({
    commandTimeout: 200,
    bufferTimeout: 50,
  });
  const fakePort = new FakeMessagePort();
  portChannelPlugin.addPort(fakePort);
  const commandBus = new CommandBus({
    plugin: portChannelPlugin,
  });

  fakePort.onmessage?.({
    data: {
      name: "ExampleCommand",
      type: "subscribeEvent",
    },
  });

  const command = new ExampleCommand(42);
  const promise = commandBus.execute(command).catch((e) => e);

  await delay(1000);

  assert((await promise).message.includes("Timeout"));
});

Deno.test("PortChannelPlugin - use local streamHandler if available", async () => {
  const portChannelPlugin = new PortChannelPlugin();
  const fakePort = new FakeMessagePort();
  portChannelPlugin.addPort(fakePort);
  const commandBus = new CommandBus({
    plugin: portChannelPlugin,
  });

  commandBus.registerStream(ExampleCommand, (_command, _context, next) => {
    next(43, true);
    return () => {};
  });

  const command = new ExampleCommand(42);
  const promise = new Promise((resolve) =>
    commandBus.stream(command, (data) => {
      resolve(data);
    })
  );

  assertEquals(fakePort.messages.length, 2);
  assertEquals(await promise, 43);
});

Deno.test("PortChannelPlugin - use local asyncStreamHandler if available", async () => {
  const portChannelPlugin = new PortChannelPlugin();
  const fakePort = new FakeMessagePort();
  portChannelPlugin.addPort(fakePort);
  const commandBus = new CommandBus({
    plugin: portChannelPlugin,
  });

  commandBus.registerStreamAsync(ExampleCommand, async function* () {
    yield 43;
  });

  const command = new ExampleCommand(42);
  const messagesLength = fakePort.messages.length;
  const promise = new Promise((resolve) =>
    commandBus.stream(command, (data) => {
      resolve(data);
    })
  );

  assertEquals(fakePort.messages.length, 3);
  assertEquals(await promise, 43);
  assertEquals(fakePort.messages.length, messagesLength);
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
