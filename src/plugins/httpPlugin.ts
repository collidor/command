import type {
  AsyncCommandBusPlugin,
  AsyncPluginHandler,
} from "../commandBusTypes.ts";
import type { Command, COMMAND_RETURN } from "../commandModel.ts";
import type { AsyncCommandBus } from "../asyncCommandBus.ts";

type ContextType = Record<string, any>;

type ArgHeaders<TContext extends ContextType = ContextType> =
  | (Record<string, string> | Headers)
  | ((
    command: Command,
    context: TContext,
  ) => Record<string, string> | Headers);

function parseHeaders<TContext extends ContextType = ContextType>(
  headers: ArgHeaders<TContext> | undefined,
  defaultHeaders: Headers,
  command: Command,
  context: TContext,
): Headers {
  if (headers === undefined) {
    return defaultHeaders;
  }
  if (headers instanceof Headers) {
    for (const header of defaultHeaders.entries()) {
      if (!headers.has(header[0])) {
        headers.append(header[0], header[1]);
      }
    }
    return headers;
  }
  const headersValue = typeof headers === "function"
    ? headers(command, context)
    : headers;
  const newHeaders = new Headers(headersValue);

  for (const header of defaultHeaders.entries()) {
    if (!newHeaders.has(header[0])) {
      newHeaders.append(header[0], header[1]);
    }
  }
  return newHeaders;
}

export type CommandSerializer<S extends BodyInit> = {
  serialize: (data: any, headers: Headers) => S;
  deserializeResponse: (response: Response) => Promise<any>;
  deserializeRequest: (request: Request) => Promise<any>;
};

const defaultSerializer: CommandSerializer<string> = {
  serialize: (data, headers) => {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return JSON.stringify(data);
  },
  deserializeResponse: (response) => {
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    return response.json();
  },
  deserializeRequest: (request) => request.json(),
};

/**
 * A plugin that forwards commands via HTTP fetch if no local handler is found.
 */
export function httpClientPlugin<
  TContext extends ContextType = ContextType,
  TSerializer extends BodyInit = string,
>(
  route:
    | string
    | URL
    | ((command: Command, context: TContext) => string | URL),
  options?: {
    headers?: ArgHeaders<TContext>;
    serializer?: CommandSerializer<TSerializer>;
    requestInit?: RequestInit;
  },
): AsyncCommandBusPlugin<Command, TContext> & {
  defaultHeaders: Headers;
} {
  const defaultHeaders = new Headers();

  const handler: AsyncPluginHandler<Command, TContext> = async (
    command,
    context,
    next,
  ) => {
    // 1. Prefer local execution if available
    if (next) {
      return next(command, context);
    }

    // 2. Fallback to HTTP
    const {
      headers = new Headers(),
      serializer = defaultSerializer,
      requestInit = {},
    } = options ?? {};

    const url = typeof route === "function" ? route(command, context) : route;

    const headersValue = parseHeaders(
      headers,
      defaultHeaders,
      command,
      context,
    );

    const body = serializer.serialize(
      { data: command.data, name: command.constructor.name },
      headersValue,
    );

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: headersValue,
      body,
      credentials: "same-origin",
      ...requestInit,
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    return serializer.deserializeResponse(response);
  };

  return { handler, defaultHeaders };
}

/**
 * A plugin that acts as a receiver for HTTP requests to execute commands on the bus.
 */
export function httpServerPlugin<
  TContext extends ContextType = ContextType,
  TSerializer extends BodyInit = string,
>(
  options?: {
    serializer?: CommandSerializer<TSerializer>;
  },
): AsyncCommandBusPlugin<Command, TContext> & {
  getCommandFromRequest: (
    request: Request,
  ) => Promise<Command>;
  handleRequest: (
    request: Request,
    context?: TContext,
  ) => Promise<Command[COMMAND_RETURN]>;
} {
  let commandBus: AsyncCommandBus<TContext> | undefined;

  function install(commandBusInstance: AsyncCommandBus<TContext>) {
    commandBus = commandBusInstance;
  }

  async function getCommandFromRequest(request: Request) {
    if (!commandBus) {
      throw new Error("Plugin not installed");
    }
    const { serializer = defaultSerializer } = options ?? {};
    const commandObject = await serializer.deserializeRequest(request);

    // Looks up the constructor from the map
    const commandConstructor = commandBus.commandConstructor.get(
      commandObject.name,
    );

    if (!commandConstructor) {
      throw new Error(`Command not found: ${commandObject.name}`);
    }

    return new commandConstructor(commandObject.data);
  }

  async function handleRequest(request: Request, context?: TContext) {
    if (!commandBus) {
      throw new Error("Plugin not installed");
    }
    const command = await getCommandFromRequest(request);

    // execute returns a Promise in AsyncCommandBus
    return await commandBus.execute(command, context);
  }

  return {
    install,
    getCommandFromRequest,
    handleRequest,
    // The server plugin doesn't usually intercept outgoing commands
    handler: (_command, _context, next) => {
      if (next) {
        return next(_command, _context);
      }
      throw new Error("Not implemented");
    },
  };
}
