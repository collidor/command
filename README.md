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
npm install your-package-name
```

## Features

* Type-safe command execution - Return types automatically match handlers
* Plugin architecture - Transform outputs to Promises, Streams, or custom types
* Flexible context - Carry execution state through context object
* Simple API - Only two methods: register and execute
* Iterator support - Built-in handling of generators and async streams

## Basic Usage

```typescript
import { CommandBus } from "your-package-name";

// 1. Define command
class CreateUser extends Command<{ id: string }> {}

// 2. Create bus
const bus = new CommandBus();

// 3. Register handler
bus.register(CreateUser, (command, context) => ({
  id: Math.random().toString(36).substr(2, 9),
}));

// 4. Execute (type inferred as { id: string })
const user = bus.execute(new CreateUser());
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

|     Method    |             Description                |
| ------------- | -------------------------------------- |
| `register<C>` | Register command handler               |
| `execute<C>`  | Execute command with type inference    |

### Type Helpers

```typescript
type PluginHandler<C, TContext, R> = (
  command: C,
  context: TContext,
  handler?: (command: C, context: TContext) => R
) => R;
```

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
const errorHandlingPlugin: PluginHandler<Command, any> =
  (command, ctx, handler) => {
    try {
      return handler?.(command, ctx);
    } catch (error) {
      console.error("Command failed:", command);
      throw error;
    }
  };

const safeBus = new CommandBus({ plugin: errorHandlingPlugin });
```

## Type Transformations

Automatic return type wrapping based on plugin:

```typescript
// Given this plugin:
const plugin = (command, ctx, handler) => [handler?.(command, ctx)];

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