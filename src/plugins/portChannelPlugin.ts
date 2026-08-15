import {
  type DataEvent,
  PortChannel,
  type PortChannelOptions,
} from "@collidor/event";
import type { AsyncCommandBus } from "../asyncCommandBus.ts";
import type { AsyncCommandBusPlugin, Type } from "../commandBusTypes.ts";
import type { Command, COMMAND_RETURN } from "../commandModel.ts";

type CommandDataEvent = {
  id: string;
  data: any;
};

type CommandResponseEvent = {
  id: string;
  data: any;
  done: boolean;
  error?: any;
};

type CommandUnsubscribeEvent = {
  id: string;
};

type CommandAckEvent = {
  id: string;
};

export type PortChannelPluginMetadata = {
  commandData: CommandDataEvent;
  dataEvent: DataEvent;
};

export type PortChannelPluginOptions = PortChannelOptions & {
  commandTimeout?: number;
};

const getResponseName = (name: string): string => `${name}_Response`;
const getUnsubscribeName = (name: string): string => `${name}_Unsubscribe`;
const getAckName = (name: string): string => `${name}_Ack`;

export class PortChannelPlugin extends PortChannel<any>
  implements AsyncCommandBusPlugin<Command, any> {
  // strictly typed to AsyncCommandBus
  protected commandBus!: AsyncCommandBus<any, any>;
  declare public context: any;

  protected responseSubscriptions: Map<
    string,
    Map<string, (data: any, done: boolean, error?: any) => void>
  > = new Map();

  protected activeRemoteStreamSubscriptions: Map<
    string,
    {
      command: Command<any, any>;
      context: any;
      originalNextCallback: (data: any, done: boolean, error?: any) => void;
      abortSignal?: AbortSignal;
    }
  > = new Map();

  protected timeout = 5000;

  constructor(options?: PortChannelPluginOptions) {
    super(options);
    if (options?.commandTimeout) {
      this.timeout = options.commandTimeout;
    }
  }

  // ... (removeSubscription and addSubscription helper methods remain unchanged) ...
  protected removeSubscription(
    name: string,
    id: string,
    callback: (response: CommandResponseEvent) => void,
    unsubscribeCallback: (response: CommandResponseEvent) => void,
  ): void {
    const responseName = getResponseName(name);
    const unsubscribeName = getUnsubscribeName(name);

    this.responseSubscriptions.get(responseName)?.delete(id);
    if (this.responseSubscriptions.get(responseName)?.size === 0) {
      this.responseSubscriptions.delete(responseName);
      this.unsubscribe(responseName, callback);
      this.unsubscribe(unsubscribeName, unsubscribeCallback);
    }
  }

  protected addSubscription(
    name: string,
    id: string,
    handler: (data: any, done: boolean, error?: any) => void,
    onAckFail: () => void,
  ): void {
    const responseName = getResponseName(name);
    const unsubscribeName = getUnsubscribeName(name);
    const ackName = getAckName(name);

    const callback = (response: CommandResponseEvent) => {
      const subscribedHandler = this.responseSubscriptions.get(responseName)
        ?.get(response.id);
      if (subscribedHandler) {
        subscribedHandler(response.data, response.done, response.error);
      }
      if (response.done || !subscribedHandler) {
        this.removeSubscription(name, id, callback, unsubscribeCallback);
      }
    };

    const unsubscribeCallback = (response: CommandUnsubscribeEvent) => {
      if (response.id === id) {
        this.removeSubscription(name, id, callback, unsubscribeCallback);
      }
    };

    const timer = setTimeout(() => {
      this.removeSubscription(name, id, callback, unsubscribeCallback);
      this.publish(unsubscribeName, { id } as CommandUnsubscribeEvent, {
        singleConsumer: true,
      });
      onAckFail();
    }, this.timeout);

    this.subscribe(ackName, (ackEvent: CommandAckEvent) => {
      if (ackEvent.id === id) {
        clearTimeout(timer);
      }
    });

    if (!this.responseSubscriptions.has(responseName)) {
      this.responseSubscriptions.set(responseName, new Map());
      this.subscribe(responseName, callback);
      this.subscribe(unsubscribeName, unsubscribeCallback);
    }
    this.responseSubscriptions.get(responseName)?.set(id, handler);
  }

  protected getCommandInstance(name: string, data: any): Command {
    const constructor = this.commandBus.commandConstructor.get(name);
    if (!constructor) {
      throw new Error(`No class registered for command ${data}`);
    }
    return new constructor(data);
  }

  // --- INSTALL ---
  // Updated to accept AsyncCommandBus specifically
  install(commandBus: AsyncCommandBus<any, any>, context: any): void {
    this.commandBus = commandBus;
    this.context = context;
  }

  // --- REGISTER ---
  register(command: Type<Command>) {
    // Accessing handlers from BaseCommandBus (via AsyncCommandBus)
    // Note: Ensure handlers is 'public' in BaseCommandBus
    const handler = this.commandBus.handlers.get(command.name);

    if (!handler) {
      // It's possible the command is registered elsewhere or not at all locally
      // If we are strictly a "bridge", we might not error here, but for now we keep strict check.
      // However, usually register() is called to expose a LOCAL command to the network.
      throw new Error(`Command ${command.name} not found locally to expose.`);
    }

    const responseName = getResponseName(command.name);

    this.subscribe(
      command.name,
      async (commandData: CommandDataEvent, _context, dataEvent: DataEvent) => {
        try {
          // 1. Ack
          const ackName = getAckName(command.name);
          this.publish(
            ackName,
            { id: commandData.id } as CommandAckEvent,
            { singleConsumer: true, target: dataEvent.source },
          );

          // 2. Execute
          const cmd = this.getCommandInstance(command.name, commandData.data);
          const meta: PortChannelPluginMetadata = { commandData, dataEvent };

          // We can await safely because we are in an async function
          // and we know the handler might return a Promise
          let result = handler(cmd, this.context, meta);
          if (result instanceof Promise) {
            result = await result;
          }

          // 3. Respond
          this.publish(
            responseName,
            {
              id: commandData.id,
              data: result,
              done: true,
            } as CommandResponseEvent,
            { singleConsumer: true, target: dataEvent.source },
          );
        } catch (error) {
          this.publish(
            responseName,
            {
              id: commandData.id,
              data: null,
              done: true,
              error,
            } as CommandResponseEvent,
            { singleConsumer: true, target: dataEvent.source },
          );
        }
      },
    );
  }

  // --- HANDLER (Execution) ---
  // Implements AsyncPluginHandler signature
  handler(
    command: Command,
    context: any,
  ): Promise<Command[COMMAND_RETURN]> {
    // 1. Check Local Sync Handlers
    if (this.commandBus.handlers.has(command.constructor.name)) {
      const handler = this.commandBus.handlers.get(command.constructor.name)!;
      return Promise.resolve(handler(command, context ?? this.context));
    }

    // 2. Remote Execution via PortChannel
    const { promise, resolve, reject } = Promise.withResolvers();
    const id = crypto.randomUUID();

    this.addSubscription(
      command.constructor.name,
      id,
      (data, done, error) => {
        if (error) reject(error);
        else if (done) resolve(data);
      },
      () => reject(new Error("Timeout waiting for command ack")),
    );

    this.publish(
      command.constructor.name,
      { id, data: command.data } as CommandDataEvent,
      { singleConsumer: true },
    );

    return promise as Promise<any>;
  }

  // --- STREAM REGISTRATION (Incoming Requests) ---

  protected registerAsyncStream(command: Type<Command<any, any>>): void {
    const asyncHandler = this.commandBus.asyncStreamHandlers.get(command.name);
    if (!asyncHandler) throw new Error(`Stream ${command.name} not found`);

    const responseName = getResponseName(command.name);
    const unsubscriptions = new Map<string, () => void>();
    const unsubscribeName = getUnsubscribeName(command.name);

    this.subscribe(
      unsubscribeName,
      (unsubscribeData: CommandUnsubscribeEvent) => {
        const unsubscribe = unsubscriptions.get(unsubscribeData.id);
        if (unsubscribe) {
          unsubscribe();
          unsubscriptions.delete(unsubscribeData.id);
        }
      },
    );

    this.subscribe(
      command.name,
      (commandData: CommandDataEvent, _context, dataEvent) => {
        const ackName = getAckName(command.name);
        this.publish(ackName, { id: commandData.id } as CommandAckEvent, {
          singleConsumer: true,
          target: dataEvent.source,
        });

        let unsubscribed = false;
        const cmd = this.getCommandInstance(command.name, commandData.data);
        const meta: PortChannelPluginMetadata = { commandData, dataEvent };

        // Get Async Iterator
        const iterator = asyncHandler(cmd, this.context, meta);

        if (!unsubscriptions.has(commandData.id)) {
          unsubscriptions.set(commandData.id, () => {
            unsubscribed = true;
            this.publish(
              unsubscribeName,
              { id: commandData.id } as CommandUnsubscribeEvent,
              { singleConsumer: true, target: dataEvent.source },
            );
            unsubscriptions.delete(commandData.id);
          });
        }

        const handleCurrent = (
          current: IteratorResult<any, any>,
        ): void | Promise<any> => {
          if (unsubscribed) return;

          this.publish(
            responseName,
            {
              id: commandData.id,
              data: current.value,
              done: current.done,
            } as CommandResponseEvent,
            { singleConsumer: true, target: dataEvent.source },
          );

          if (!current.done) {
            return iterator.next().then(handleCurrent);
          } else {
            unsubscriptions.delete(commandData.id);
          }
        };
        void iterator.next().then(handleCurrent);
      },
    );
  }

  registerStream(command: Type<Command<any, any>>): void {
    // 1. Try Async Stream (Native to AsyncBus)
    if (this.commandBus.asyncStreamHandlers.has(command.name)) {
      return this.registerAsyncStream(command);
    }

    // 2. Try Callback Stream (Inherited from Base)
    const handler = this.commandBus.streamHandlers.get(command.name);
    if (!handler) {
      throw new Error(`Stream ${command.name} not found`);
    }

    // ... (Existing logic for bridging callback streams to network events) ...
    const responseName = getResponseName(command.name);
    this.subscribe(
      command.name,
      (commandData: CommandDataEvent, _context, dataEvent) => {
        // ... (Ack logic) ...
        const ackName = getAckName(command.name);
        this.publish(ackName, { id: commandData.id } as CommandAckEvent, {
          singleConsumer: true,
          target: dataEvent.source,
        });

        const unsubscribeName = getUnsubscribeName(command.name);
        let unsubscribed = false;
        const cmd = this.getCommandInstance(command.name, commandData.data);
        const meta: PortChannelPluginMetadata = { commandData, dataEvent };

        const unsubscribe = handler(
          cmd,
          this.context,
          (data: any, done: boolean, error?: any) => {
            if (unsubscribed) return;
            this.publish(
              responseName,
              { id: commandData.id, data, done, error } as CommandResponseEvent,
              { singleConsumer: true, target: dataEvent.source },
            );
            if (done) {
              unsubscribed = true;
              this.publish(
                unsubscribeName,
                { id: commandData.id } as CommandUnsubscribeEvent,
              );
            }
          },
          meta,
        );

        this.subscribe(unsubscribeName, (uData: CommandUnsubscribeEvent) => {
          if (uData.id === commandData.id) {
            unsubscribed = true;
            Promise.resolve(unsubscribe).then((f) => f && f());
          }
        });
      },
    );
  }

  // --- STREAM HANDLER (Outgoing Requests) ---

  streamHandler(
    command: Command,
    context: any,
    next: (data: Command[COMMAND_RETURN], done: boolean, error?: any) => void,
    abortSignal?: AbortSignal,
  ): (() => void) | Promise<() => void> {
    // Path 1: Local Callback Stream (Base)
    if (this.commandBus.streamHandlers.has(command.constructor.name)) {
      const handler = this.commandBus.streamHandlers.get(
        command.constructor.name,
      )!;
      return handler(command, context ?? this.context, next) || (() => {});
    }

    // Path 2: Local Async Iterator Stream (AsyncBus)
    if (this.commandBus.asyncStreamHandlers.has(command.constructor.name)) {
      const handler = this.commandBus.asyncStreamHandlers.get(
        command.constructor.name,
      )!;
      let unsubscribed = false;

      (async () => {
        try {
          for await (const data of handler(command, context ?? this.context)) {
            if (unsubscribed) break;
            next(data, false);
          }
          if (!unsubscribed) next(null, true);
        } catch (error) {
          if (!unsubscribed) next(null, true, error);
        }
      })();

      if (abortSignal) {
        abortSignal.addEventListener("abort", () => {
          unsubscribed = true;
        });
      }
      return () => {
        unsubscribed = true;
      };
    }

    // Path 3: Remote Stream via PortChannel

    const instanceId = crypto.randomUUID();
    const unsubscribeName = getUnsubscribeName(command.constructor.name);

    this.activeRemoteStreamSubscriptions.set(instanceId, {
      command,
      context,
      originalNextCallback: next,
      abortSignal,
    });

    const remoteResponseCallback = (data: any, done: boolean, error?: any) => {
      if (done || error) {
        this.activeRemoteStreamSubscriptions.delete(instanceId);
      }
      next(data, done, error);
    };

    this.addSubscription(
      command.constructor.name,
      instanceId,
      remoteResponseCallback,
      () => next(null, true, new Error("Timeout waiting for command ack")),
    );

    this.publish(
      command.constructor.name,
      { id: instanceId, data: command.data } as CommandDataEvent,
      { singleConsumer: true },
    );

    const doUnsubscribe = () => {
      this.publish(
        unsubscribeName,
        { id: instanceId } as CommandUnsubscribeEvent,
      );
      this.activeRemoteStreamSubscriptions.delete(instanceId);
    };

    abortSignal?.addEventListener("abort", doUnsubscribe);

    return doUnsubscribe;
  }
}
