import {
  DataEvent,
  PortChannel,
  type PortChannelOptions,
  PortEvents,
} from "@collidor/event";
import type { CommandBus, CommandBusPlugin, Type } from "../commandBus.ts";
import { Command, COMMAND_RETURN } from "../commandModel.ts";

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

export type PortChannelPluginOptions = PortChannelOptions & {
  commandTimeout?: number;
};

const getResponseName = (name: string): string => `${name}_Response`;
const getUnsubscribeName = (name: string): string => `${name}_Unsubscribe`;
const getAckName = (name: string): string => `${name}_Ack`;

export class PortChannelPlugin extends PortChannel<any>
  implements CommandBusPlugin<Command, any, Promise<Command[COMMAND_RETURN]>> {
  protected commandBus!: CommandBus<any, any>;
  declare public context: any;

  protected responseSubscriptions: Map<
    string,
    Map<string, (data: any, done: boolean, error?: any) => void>
  > = new Map();

  protected activeRemoteStreamSubscriptions: Map<
    string, // Unique ID for each stream instance subscription
    {
      command: Command<any, any>;
      context: any; // The context passed to CommandBus.stream
      originalNextCallback: (data: any, done: boolean, error?: any) => void; // The original callback from the user
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

  /**
   * Adds a subscription for a given command response.
   * When no more handlers are left, it unsubscribes from the underlying events.
   */
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
      const subscribedHandler = this.responseSubscriptions.get(
        responseName,
      )
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
      this.publish(
        unsubscribeName,
        { id } as CommandUnsubscribeEvent,
        { singleConsumer: true },
      );
      onAckFail();
      clearTimeout(timer);
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

  install(commandBus: CommandBus<any, any>, context: any): void {
    this.commandBus = commandBus;
    this.context = context;
  }

  register(command: Type<Command>) {
    const handler = this.commandBus.handlers.get(command.name);
    if (!handler) {
      throw new Error(`Command ${command.name} not found`);
    }

    const responseName = getResponseName(command.name);

    this.subscribe(
      command.name,
      async (
        commandData: CommandDataEvent,
        _context,
        dataEvent: DataEvent,
      ) => {
        try {
          // Acknowledge the command reception
          const ackName = getAckName(command.name);
          const ackEvent: CommandAckEvent = {
            id: commandData.id,
          };
          this.publish(ackName, ackEvent, {
            singleConsumer: true,
            target: dataEvent.source,
          });

          // Process the command
          const cmd = this.getCommandInstance(
            command.name,
            commandData.data,
          );
          let result = handler(cmd, this.context);
          if (result instanceof Promise) {
            result = await result;
          }

          this.publish(
            responseName,
            {
              id: commandData.id,
              data: result,
              done: true,
            } as CommandResponseEvent,
            {
              singleConsumer: true,
              target: dataEvent.source,
            },
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
            {
              singleConsumer: true,
              target: dataEvent.source,
            },
          );
        }
      },
    );
  }

  /**
   * Dispatches a command by publishing it on the channel.
   * A timeout is set to prevent memory leaks if no response arrives.
   */
  handler(
    command: Command,
    context: any,
  ): Promise<Command[COMMAND_RETURN]> {
    if (this.commandBus.handlers.has(command.constructor.name)) {
      const handler = this.commandBus.handlers.get(
        command.constructor.name,
      )!;
      return Promise.resolve(handler(command, context ?? this.context));
    }

    const { promise, resolve, reject } = Promise.withResolvers();
    const id = crypto.randomUUID();
    // // 5 seconds timeout

    this.addSubscription(
      command.constructor.name,
      id,
      (data: any, done: boolean, error?: any) => {
        if (error) {
          reject(error);
        }
        if (done) {
          resolve(data);
        }
      },
      () => {
        reject(new Error("Timeout waiting for command ack"));
      },
    );

    this.publish(
      command.constructor.name,
      {
        id,
        data: command.data,
      } as CommandDataEvent,
      {
        singleConsumer: true,
      },
    );

    return promise;
  }

  /**
   * Registers an asynchronous stream handler.
   * Adds a timeout/cancellation mechanism via unsubscribe events.
   */
  protected registerAsyncStream(command: Type<Command<any, any>>): void {
    const asyncHandler = this.commandBus.asyncStreamHandlers.get(
      command.name,
    );
    if (!asyncHandler) {
      throw new Error(`Stream ${command.name} not found`);
    }

    const responseName = getResponseName(command.name);
    const unsubscriptions = new Map<string, () => void>();
    const unsubscribeName = getUnsubscribeName(command.name);

    // Subscribe for unsubscribe events once.
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
        // Acknowledge the command reception
        const ackName = getAckName(command.name);
        this.publish(
          ackName,
          {
            id: commandData.id,
          } as CommandAckEvent,
          {
            singleConsumer: true,
            target: dataEvent.source,
          },
        );

        // Process the command
        let unsubscribed = false;
        const cmd = this.getCommandInstance(
          command.name,
          commandData.data,
        );
        const iterator = asyncHandler(cmd, this.context);

        if (!unsubscriptions.has(commandData.id)) {
          unsubscriptions.set(commandData.id, () => {
            unsubscribed = true;
            this.publish(
              unsubscribeName,
              {
                id: commandData.id,
              } as CommandUnsubscribeEvent,
              {
                singleConsumer: true,
                target: dataEvent.source,
              },
            );
            unsubscriptions.delete(commandData.id);
          });
        }

        const handleCurrent = (
          current: IteratorResult<any, any>,
        ): void | Promise<any> => {
          if (unsubscribed) {
            return;
          }

          this.publish(
            responseName,
            {
              id: commandData.id,
              data: current.value,
              done: current.done,
            } as CommandResponseEvent,
            {
              singleConsumer: true,
              target: dataEvent.source,
            },
          );

          if (!current.done) {
            return iterator.next().then(handleCurrent);
          } else {
            // Clean up when stream completes
            unsubscriptions.delete(commandData.id);
          }
        };
        void iterator.next().then(handleCurrent);
      },
    );
  }

  registerStream(command: Type<Command<any, any>>): void {
    const asyncHandler = this.commandBus.asyncStreamHandlers.get(
      command.name,
    );
    if (asyncHandler) {
      return this.registerAsyncStream(command);
    }

    const handler = this.commandBus.streamHandlers.get(command.name);
    if (!handler) {
      throw new Error(`Stream ${command.name} not found`);
    }

    const responseName = getResponseName(command.name);

    this.subscribe(
      command.name,
      (commandData: CommandDataEvent, _context, dataEvent) => {
        // Ack the command reception
        const ackName = getAckName(command.name);
        this.publish(
          ackName,
          {
            id: commandData.id,
          } as CommandAckEvent,
          {
            singleConsumer: true,
            target: dataEvent.source,
          },
        );

        const unsubscribeName = getUnsubscribeName(command.name);
        let unsubscribed = false;

        const cmd = this.getCommandInstance(
          command.name,
          commandData.data,
        );
        const unsubscribe = handler(
          cmd,
          this.context,
          (data: any, done: boolean, error?: any) => {
            if (unsubscribed) {
              return;
            }

            this.publish(
              responseName,
              {
                id: commandData.id,
                data,
                done,
                error,
              } as CommandResponseEvent,
              {
                singleConsumer: true,
                target: dataEvent.source,
              },
            );

            if (done) {
              unsubscribed = true;
              this.publish(
                unsubscribeName,
                {
                  id: commandData.id,
                } as CommandUnsubscribeEvent,
              );
            }
          },
        );

        this.subscribe(
          unsubscribeName,
          (unsubscribeData: CommandUnsubscribeEvent) => {
            if (unsubscribeData.id === commandData.id) {
              unsubscribed = true;
              if (unsubscribe) {
                Promise.resolve(unsubscribe).then((f) => f());
              }
            }
          },
        );
      },
    );
  }

  streamHandler(
    command: Command,
    context: any,
    next: (
      data: Command[COMMAND_RETURN],
      done: boolean,
      error?: any,
    ) => void,
    abortSignal?: AbortSignal,
  ): (() => void) | Promise<() => void> {
    // Path 1: Local stream handler exists (not routed remotely by this plugin)
    if (this.commandBus.streamHandlers.has(command.constructor.name)) {
      const unsubscribe = this.commandBus.streamHandlers.get(
        command.constructor.name,
      )!(
        command,
        context ?? this.context,
        next,
      );

      return () => {
        if (unsubscribe) {
          Promise.resolve(unsubscribe).then((f) => f());
        }
      };
    }

    // Path 2: Local async stream handler exists (not routed remotely by this plugin)
    if (this.commandBus.asyncStreamHandlers.has(command.constructor.name)) {
      const handler = this.commandBus.asyncStreamHandlers.get(
        command.constructor.name,
      );
      if (!handler) {
        throw new Error(
          `No stream plugin registered for ${command.constructor.name}`,
        );
      }

      let unsubscribed = false;

      (async () => {
        for await (const data of handler(command, this.context)) {
          if (unsubscribed) {
            return () => {};
          }

          next(data, false);
        }
        next(null, true);
      })().catch((error) => {
        next(null, true, error);
      });

      abortSignal?.addEventListener("abort", () => {
        unsubscribed = true;
      });
      return () => {
        unsubscribed = true;
      };
    }

    // Path 3: No local handler, route remotely via PortChannelPlugin (Client-side logic)
    const instanceId = crypto.randomUUID(); // Unique ID for this specific stream instance

    // Store this subscription for potential future resumption
    this.activeRemoteStreamSubscriptions.set(instanceId, {
      command,
      context,
      originalNextCallback: next, // Store the original callback
      abortSignal,
    });
    const unsubscribeName = getUnsubscribeName(command.constructor.name);

    // This is the callback for responses from the remote (server) side
    const remoteResponseCallback = (data: any, done: boolean, error?: any) => {
      // If the stream completes or errors, remove it from active subscriptions
      if (done || error) {
        this.activeRemoteStreamSubscriptions.delete(instanceId);
      }
      next(data, done, error); // Pass data to the original user callback
    };

    this.addSubscription(
      command.constructor.name,
      instanceId,
      remoteResponseCallback,
      () => {
        next(null, true, new Error("Timeout waiting for command ack"));
      },
    );

    this.publish(
      command.constructor.name,
      {
        id: instanceId,
        data: command.data,
      } as CommandDataEvent,
      {
        singleConsumer: true,
      },
    );

    abortSignal?.addEventListener("abort", () => {
      this.publish(
        unsubscribeName,
        {
          id: instanceId,
        } as CommandUnsubscribeEvent,
      );

      this.activeRemoteStreamSubscriptions.delete(instanceId);
    });

    return () => {
      this.publish(
        unsubscribeName,
        {
          id: instanceId,
        } as CommandUnsubscribeEvent,
      );
      this.activeRemoteStreamSubscriptions.delete(instanceId);
    };
  }
}
