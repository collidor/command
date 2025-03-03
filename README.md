[![Codecov](https://codecov.io/gh/collidor/command/branch/main/graph/badge.svg)](https://codecov.io/gh/collidor/command)

# Command

A lightweight, type-safe command pattern implementation with plugin support:

- 🚀 Zero dependencies
- 🔌 Extensible plugin system
- 🔄 Async/Stream/Generator support
- 🛠️ Full TypeScript type inference
- 🌐 Context-aware execution

## Installation

```bash
npm install @collidor/command
```

## Features

* Type-safe command execution - Return types automatically match handlers
* Plugin architecture - Transform outputs to Promises, Streams, or custom types
* Flexible context - Carry execution state through context object
* Simple API - Only two methods: register and execute
* Iterator support - Built-in handling of generators and async streams

## Basic Usage

```typescript
import { CommandBus } from "@collidor/command";

// 1. Define command
class CreateUser extends Command<{name: string}, { id: string }> {}

// 2. Create bus
const bus = new CommandBus();

// 3. Register handler
bus.register(CreateUser, (command, context) => ({
  id: Math.random().toString(36).substr(2, 9),
}));

// 4. Execute (type inferred as { id: string })
const user = bus.execute(new CreateUser());
```

## Async Stream Methods
For scenarios where a command handler produces multiple asynchronous events, you can now register an async stream handler that returns an AsyncIterable. This lets you consume command streams using a natural for await … of loop.

### Registering an Async Stream Handler
Use registerStreamAsync to register a handler that returns an async iterator. This handler can perform asynchronous work and yield events over time.

```ts
import { CommandBus, Command } from "@collidor/command";

// Define a command
class UpdateUser extends Command<number, { status: string }> {}

// Create a CommandBus instance
const commandBus = new CommandBus();

// Register an async stream handler
commandBus.registerStreamAsync(UpdateUser, async function* (command, context) {
  for (let i = 0; i < command.data; i++) {
    // Simulate asynchronous delay
    await new Promise((resolve) => setTimeout(resolve, 100));
    yield { status: `update-${i}` };
  }
});
```

### Consuming Async Streams

The streamAsync method returns an async iterator. You can easily consume the stream with a for await … of loop:

```ts
(async () => {
  // Execute the command and consume the async stream
  for await (const result of commandBus.streamAsync(new UpdateUser(5))) {
    console.log(result);
  }
  // Expected output:
  // { status: 'update-0' }
  // { status: 'update-1' }
  // { status: 'update-2' }
  // { status: 'update-3' }
  // { status: 'update-4' }
})();

```

## Plugin System

### Async Operations

```typescript
const asyncBus = new CommandBus({
  plugin: (command, ctx, handler) => {
    return Promise.resolve(handler?.(command, ctx));
  }
});

// Returns Promise<{ id: string }>
const futureUser = asyncBus.execute(new CreateUser());
```

### Stream Processing

```typescript
const streamBus = new CommandBus({
  plugin: async function* (command, ctx, handler) {
    yield await handler?.(command, ctx);
    yield await handler?.(command, ctx);
  }
});

// Returns AsyncIterable<{ id: string }>
for await (const result of streamBus.execute(new CreateUser())) {
  console.log(result);
}
```

## API Documentation

`CommandBus<TContext, TPlugin>`

### Constructor

### Methods

|           Method          |                             Description                              |
| ------------------------- | -------------------------------------------------------------------- |
| `register<C>`             | Register command handler                                             |
| `execute<C>`              | Execute command with type inference                                  |
| `registerStream<C>`       | Register a stream command handler                                    |
| `stream<C>`               | Execute a command with the result calling the callback overtime      |
| `registerStreamAsync<C>`  | Register an async stream handler that returns an `AsyncIterable`     |
| `streamAsync<C>`          | Execute a command and return an async iterator for streaming events. |

## Advanced Usage

### Custom Context

```typescript
interface AppContext {
  requestId: string;
  user: { id: string };
}

const bus = new CommandBus<AppContext>({
  context: {
    requestId: "123",
    user: { id: "system" }
  }
});

bus.register(CreateUser, (cmd, ctx) => {
  console.log(ctx.user.id); // "system"
  return { id: ctx.requestId };
});
```


### Error Handling Plugin

```typescript

const errorHandlingPlugin: CommandBusPlugin<
    Command,
    typeof context,
    Command[COMMAND_RETURN]
  > = {
    handler: (command, ctx, handler) => {
        try {
            return {
                success: true,
                value: handler?.(command, ctx)
            };
        } catch (error) {
            console.error("Command failed:", command);
            return {
                success: false,
                error,
            }
        }
    },
  };

const safeCommandBus = new CommandBus({ plugin: errorHandlingPlugin });
```

## Plugins

### HTTP Plugin

The HTTP plugin integrates your CommandBus with HTTP endpoints—on both the client and server side—while preserving full type safety and leveraging the plugin system.

#### HTTP Client Plugin

The httpClientPlugin intercepts command execution and makes an HTTP POST request to your API endpoint. It supports:

* Dynamic routes: Provide a function to generate the URL based on the command and context.
* Custom headers: Supply static headers or a function that returns headers.
* Custom serializers: Override the default JSON serializer for different content types.

**Example Usage:**

```ts
import { CommandBus, Command, httpClientPlugin } from "@collidor/command";

// Define a command
class CreateUser extends Command<{ name: string }, { id: string }> {}

// Create the HTTP client plugin with custom headers
const clientPlugin = httpClientPlugin("http://api.example.com/createUser", {
  headers: () => ({
    "X-API-Key": "my-secret-key",
  }),
});

// Create the CommandBus with the HTTP client plugin installed.
// If a local handler is registered, it will take precedence.
const bus = new CommandBus({ plugin: clientPlugin });

// Execute the command.
// makes an HTTP POST.
const user = await bus.execute(new CreateUser({ name: "Alice" }));
console.log(user); // e.g. { id: "generated-id-xxx" }

```

**Notes:**

If a local handler is provided, it will be used; otherwise, the HTTP client plugin sends a POST request.
The default serializer converts data to JSON and expects JSON responses, but you can supply your own.

#### HTTP Server Plugin

The httpServerPlugin enables you to expose your CommandBus as an HTTP endpoint. It provides helper methods to:

* Extract a command from a request: getCommandFromRequest
* Handle a request: handleRequest

This plugin deserializes the incoming request into a command, executes it on the bus, and returns the result.

**Example Usage:**

```ts
import { CommandBus, Command, httpServerPlugin } from "@collidor/command";

// Define a command
class CreateUser extends Command<{ name: string }, { id: string }> {}

// Create an HTTP server plugin instance
const serverPlugin = httpServerPlugin();

// Create the CommandBus with the server plugin installed
const bus = new CommandBus({ plugin: serverPlugin });

// Register a command handler
bus.register(CreateUser, (command) => ({
  id: "generated-id-" + Math.random().toString(36).substring(2, 9),
}));

// Simulate an HTTP POST request (e.g., within your web framework)
const request = new Request("http://api.example.com", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    data: { name: "Alice" },
    name: CreateUser.name,
  }),
});

// Handle the request using the plugin
serverPlugin.handleRequest(request).then((result) => {
  console.log(result);
  // Expected output: { id: "generated-id-xxx" }
});

```

**Notes:**

Ensure that the plugin is installed via the CommandBus so that getCommandFromRequest can access the command constructors.
The server plugin uses the same serializer logic as the client plugin by default. Customize it if needed.

#### Customizing Serialization

Both HTTP plugins allow you to provide a custom serializer if you need to work with different data formats or content types.

**Example:**

```ts
import { Serializer } from "@collidor/command/plugins/httpPlugin";

const customSerializer: Serializer<Blob> = {
  serialize: (data, headers) => {
    headers.set("Content-Type", "application/octet-stream");
    return new Blob([JSON.stringify(data)], { type: "application/octet-stream" });
  },
  deserializeResponse: async (response) => {
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    const text = await response.text();
    return JSON.parse(text);
  },
  deserializeRequest: async (request) => {
    const text = await request.text();
    return JSON.parse(text);
  },
};

const clientPlugin = httpClientPlugin("http://api.example.com", {
  serializer: customSerializer,
});

```

By integrating the HTTP client and server plugins, you can easily connect your command handlers with remote HTTP services while still enjoying all the benefits of type safety and plugin extensibility offered by the Command library.

## Type Transformations

Automatic return type wrapping based on plugin:

```typescript
// Given this plugin:
  const plugin: CommandBusPlugin<
    Command,
    typeof context,
    Command[COMMAND_RETURN][]
  > = {
    handler: (command, c, h) => [(h?.(command, c))],
  };

// Return type becomes Array<{ id: string }>
const result = bus.execute(new CreateUser());
```

# Contribution

1. Fork repository
2. Create feature branch (git checkout -b feature/fooBar)
3. Commit changes (git commit -am 'Add some fooBar')
4. Push to branch (git push origin feature/fooBar)
5. Create new Pull Request

# License

MIT © Alykam Burdzaki