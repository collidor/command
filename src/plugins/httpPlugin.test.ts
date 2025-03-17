import { assertEquals, assertRejects } from "@std/assert";
import { resolvesNext, stub } from "@std/testing/mock";
import { Command } from "../commandModel.ts";
import { httpClientPlugin, httpServerPlugin } from "./httpPlugin.ts";
import { CommandBus } from "../commandBus.ts";

class ExampleCommand extends Command<number, number> {}

Deno.test("httpClientPlugin - should use local handler if provided", async () => {
  const command = new ExampleCommand(42);
  const plugin = httpClientPlugin("http://example.com");

  const commandBus = new CommandBus({ plugin });
  commandBus.register(ExampleCommand, (command) => command.data + 1);
  const result = await commandBus.execute(command);
  assertEquals(result, 43);
});

Deno.test("httpClientPlugin - should perform HTTP POST and return response JSON", async () => {
  using fetchStub = stub(
    globalThis,
    "fetch",
    resolvesNext([
      new Response(JSON.stringify(42), { status: 200 }),
    ]),
  );

  const command = new ExampleCommand(10);
  const plugin = httpClientPlugin("http://example.com");
  const commandBus = new CommandBus({ plugin });
  const result = await commandBus.execute(command);

  assertEquals(result, 42);
  assertEquals(fetchStub.calls.length, 1);
  assertEquals(fetchStub.calls[0]?.args[1]?.method, "POST");
  assertEquals(
    JSON.parse(fetchStub.calls[0]?.args[1]?.body as string || "").name,
    "ExampleCommand",
  );
  assertEquals(
    (fetchStub.calls[0]?.args[1]?.headers as Headers)?.get("Content-Type"),
    "application/json",
  );
});

Deno.test("httpClientPlugin - should throw error on non-ok HTTP response", async () => {
  using _fetchStub = stub(
    globalThis,
    "fetch",
    resolvesNext([new Response("Not Found", { status: 404 })]),
  );

  const command = new ExampleCommand(10);
  const plugin = httpClientPlugin("http://example.com");
  await assertRejects(
    async () => {
      await plugin.handler?.(command, {});
    },
    Error,
    "HTTP error: 404",
  );
});

Deno.test("httpClientPlugin - should use dynamic route function", async () => {
  using fetchStub = stub(
    globalThis,
    "fetch",
    resolvesNext([
      new Response(JSON.stringify(42), { status: 200 }),
    ]),
  );

  const command = new ExampleCommand(10);
  const plugin = httpClientPlugin(
    (cmd) => `http://example.com/${cmd.constructor.name}`,
  );
  const commandBus = new CommandBus({ plugin });
  const result = await commandBus.execute(command);
  assertEquals(result, 42);
  assertEquals(
    fetchStub.calls[0]?.args[0],
    "http://example.com/ExampleCommand",
  );
});

Deno.test("httpClientPlugin - should set custom headers via function", async () => {
  using fetchStub = stub(
    globalThis,
    "fetch",
    resolvesNext([
      new Response(JSON.stringify(42), { status: 200 }),
    ]),
  );

  const command = new ExampleCommand(10);
  const plugin = httpClientPlugin(
    "http://example.com",
    {
      headers: () => ({ "X-Test": "true" }),
    },
  );

  const commandBus = new CommandBus({ plugin });
  const result = await commandBus.execute(command);
  assertEquals(result, 42);
  assertEquals(
    (fetchStub.calls[0]?.args[1]?.headers as Headers).get("X-Test"),
    "true",
  );
  assertEquals(
    (fetchStub.calls[0]?.args[1]?.headers as Headers).get("Content-Type"),
    "application/json",
  );
});

Deno.test("httpClientPlugin - should append the default headers on every request", async () => {
  using fetchStub = stub(
    globalThis,
    "fetch",
    resolvesNext([
      new Response(JSON.stringify(42), { status: 200 }),
    ]),
  );

  const command = new ExampleCommand(10);
  const plugin = httpClientPlugin(
    "http://example.com",
    {
      headers: () => ({ "X-Test": "true" }),
    },
  );

  plugin.defaultHeaders.set("userId", "123");

  const commandBus = new CommandBus({ plugin });
  const result = await commandBus.execute(command);
  assertEquals(result, 42);
  assertEquals(
    (fetchStub.calls[0]?.args[1]?.headers as Headers).get("X-Test"),
    "true",
  );
  assertEquals(
    (fetchStub.calls[0]?.args[1]?.headers as Headers).get("Content-Type"),
    "application/json",
  );
  assertEquals(
    (fetchStub.calls[0]?.args[1]?.headers as Headers).get("userId"),
    "123",
  );
});

// httpServerCommand tests

Deno.test("httpServerCommand - should wrap synchronous command result", async () => {
  const plugin = httpServerPlugin();

  const bus = new CommandBus({
    plugin,
  });

  // Synchronous handler returns a number (e.g. data + 1)
  bus.register(ExampleCommand, (cmd) => cmd.data + 1);

  const request = new Request("http://example.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: 42, name: ExampleCommand.name }),
  });

  const result = await plugin.handleRequest(request);
  assertEquals(result, 43);
});

Deno.test("httpServerCommand - should wrap asynchronous command result", async () => {
  const plugin = httpServerPlugin();

  const bus = new CommandBus({
    plugin,
  });

  // Async handler returns a promise that resolves to (data * 2)
  bus.register(ExampleCommand, (cmd) => Promise.resolve(cmd.data * 2));

  const request = new Request("http://example.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: 42, name: ExampleCommand.name }),
  });
  const result = await plugin.handleRequest(request);
  assertEquals(result, 84);
});

Deno.test("httpServerCommand - should throw error for synchronous errors", () => {
  const plugin = httpServerPlugin();

  const bus = new CommandBus({
    plugin,
  });
  // Handler that throws an error
  bus.register(ExampleCommand, () => {
    throw new Error("Sync error");
  });
  const request = new Request("http://example.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: 42, name: ExampleCommand.name }),
  });

  assertRejects(() => plugin.handleRequest(request), Error, "Sync error");
});

Deno.test("httpServerCommand - should trhow error object for asynchronous errors", () => {
  const plugin = httpServerPlugin();

  const bus = new CommandBus({
    plugin,
  });
  // Handler that returns a promise that rejects
  bus.register(ExampleCommand, () => Promise.reject(new Error("Async error")));

  const request = new Request("http://example.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: 42, name: ExampleCommand.name }),
  });

  assertRejects(() => plugin.handleRequest(request), Error, "Async error");
});

Deno.test("httpServerCommand - should pass custom context to command handler", async () => {
  const plugin = httpServerPlugin();

  const bus = new CommandBus({
    plugin,
  });

  const context = { test: 3 };
  bus.register(ExampleCommand, (command, ctx) => ctx.test * command.data);

  const request = new Request("http://example.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: 42, name: ExampleCommand.name }),
  });

  const result = await plugin.handleRequest(request, context);
  assertEquals(result, 126);
});

Deno.test("httpServerCommand - should return error object if no handler registered", async () => {
  const plugin = httpServerPlugin();
  const _bus = new CommandBus({
    plugin,
  });

  const request = new Request("http://example.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: 42, name: ExampleCommand.name }),
  });

  await assertRejects(
    () => plugin.handleRequest(request),
    Error,
    "Command not found: ExampleCommand",
  );
});

Deno.test("httpServerCommand - should throw an error if plugin is not installed", async () => {
  const plugin = httpServerPlugin();
  const request = new Request("http://example.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: 42, name: ExampleCommand.name }),
  });

  await assertRejects(
    () => plugin.handleRequest(request),
    Error,
    "Plugin not installed",
  );
});
