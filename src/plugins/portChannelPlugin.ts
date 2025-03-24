import {
  type DataEvent,
  PortChannel,
  type PortChannelOptions,
} from "@collidor/event";
import type { CommandBus, CommandBusPlugin, Type } from "../commandBus.ts";
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

export type PortChannelPluginOptions = PortChannelOptions & {
  commandTimeout?: number;
};

const getResponseName = (name: string): string => `${name}_Response`;
const getUnsubscribeName = (name: string): string => `${name}_Unsubscribe`;

export class PortChannelPlugin extends PortChannel<any>
  implements CommandBusPlugin<Command, any, Promise<Command[COMMAND_RETURN]>> {
  protected commandBus!: CommandBus<any, any>;
  declare public context: any;

  protected responseSubscriptions: Map<
    string,
    Map<string, (data: any, done: boolean, error?: any) => void>
  > = new Map();

  protected timeout = 5000;

  constructor(options?: PortChannelPluginOptions) {
    super(options);
    if (options?.commandTimeout) {
      this.timeout = options.commandTimeout;
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
  ) {
    const responseName = getResponseName(name);
    const unsubscribeName = getUnsubscribeName(name);

    const removeSubscription = () => {
      this.responseSubscriptions.get(responseName)?.delete(id);
      if (this.responseSubscriptions.get(responseName)?.size === 0) {
        this.responseSubscriptions.delete(responseName);
        this.unsubscribe(responseName, callback);
        this.unsubscribe(unsubscribeName, unsubscribeCallback);
      }
    };

    const callback = (response: CommandResponseEvent) => {
      const subscribedHandler = this.responseSubscriptions.get(
        responseName,
      )
        ?.get(id);
      if (subscribedHandler) {
        subscribedHandler(response.data, response.done, response.error);
      }

      if (response.done || !subscribedHandler) {
        removeSubscription();
      }
    };

    const unsubscribeCallback = (response: CommandUnsubscribeEvent) => {
      if (response.id === id) {
        removeSubscription();
      }
    };

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
    // 5 seconds timeout

    // Set up a timeout to auto-reject if no response is received.
    const timer = setTimeout(() => {
      const unsubscribeName = getUnsubscribeName(
        command.constructor.name,
      );
      this.publish(unsubscribeName, { id } as CommandUnsubscribeEvent);
      reject(new Error("Timeout waiting for command response"));
      clearTimeout(timer);
    }, this.timeout);

    this.addSubscription(
      command.constructor.name,
      id,
      (data: any, done: boolean, error?: any) => {
        clearTimeout(timer);
        if (error) {
          reject(error);
        }
        if (done) {
          resolve(data);
        }
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
              Promise.resolve(unsubscribe).then((f) => f());
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
  ): (() => void) | Promise<() => void> {
    if (this.commandBus.streamHandlers.has(command.constructor.name)) {
      return this.commandBus.streamHandlers.get(
        command.constructor.name,
      )!(
        command,
        context ?? this.context,
        next,
      );
    }

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
      return () => {
        unsubscribed = true;
      };
    }

    const id = crypto.randomUUID();
    const unsubscribeName = getUnsubscribeName(command.constructor.name);

    this.addSubscription(command.constructor.name, id, next);

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

    return () => {
      this.publish(
        unsubscribeName,
        {
          id,
        } as CommandUnsubscribeEvent,
      );
    };
  }
}
