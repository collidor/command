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
  ackTimeout?: number;
};

export class PortChannelPlugin
  extends PortChannel<any>
  implements AsyncCommandBusPlugin<Command, any>
{
  protected commandBus!: AsyncCommandBus<any, any>;
  declare public context: any;

  protected commandSubscriptions: Map<
    string,
    (data: any, context: any, dataEvent: any) => void
  > = new Map();

  constructor(options?: PortChannelPluginOptions) {
    super(options);
    if (options?.commandTimeout) {
      this.timeout = options.commandTimeout;
    }
    if (options?.ackTimeout !== undefined) {
      this.ackTimeout = options.ackTimeout;
    } else if (options?.commandTimeout) {
      this.ackTimeout = Math.min(500, options.commandTimeout);
    }
  }

  public unregister(command: Type<Command> | string): void {
    const commandName = typeof command === "string" ? command : command.name;
    const callback = this.commandSubscriptions.get(commandName);
    if (callback) {
      this.unsubscribe(commandName, callback as any);
      this.commandSubscriptions.delete(commandName);
    } else {
      (this.unsubscribe as any)(commandName);
    }
  }

  protected getCommandInstance(name: string, data: any): Command {
    const constructor = this.commandBus.commandConstructor.get(name);
    if (!constructor) {
      throw new Error(`No class registered for command ${data}`);
    }
    return new constructor(data);
  }

  // --- INSTALL ---
  install(commandBus: AsyncCommandBus<any, any>, context: any): void {
    this.commandBus = commandBus;
    this.context = context;
  }

  // --- REGISTER ---
  register(command: Type<Command>): void {
    const handler = this.commandBus.getHandler(command.name);

    if (!handler && !this.commandBus.providedCommands.has(command.name)) {
      throw new Error(`Command ${command.name} not found locally to expose.`);
    }

    const responseName = this.getResponseName(command.name);

    const subscription = async (
      commandData: CommandDataEvent,
      _context: any,
      dataEvent: DataEvent,
    ) => {
      try {
        // 1. Ack
        const ackName = this.getAckName(command.name);
        this.publish(ackName, { id: commandData.id } as CommandAckEvent, {
          singleConsumer: true,
          target: dataEvent.source,
        });

        // 2. Execute
        const cmd = this.getCommandInstance(command.name, commandData.data);
        const meta: PortChannelPluginMetadata = { commandData, dataEvent };

        const execHandler = this.commandBus.getHandler(command.name) ?? handler;
        if (!execHandler) {
          throw new Error(`No handler registered for ${command.name}`);
        }
        let result = execHandler(cmd, this.context, meta);
        if (typeof result?.then === "function") {
          result = await (result as Promise<any>);
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
    };

    this.commandSubscriptions.set(command.name, subscription);
    this.subscribe(command.name, subscription);
  }

  // --- HANDLER (Execution) ---
  handler(
    command: Command,
    context: any,
    handler?: (
      command: Command,
      context: any,
    ) => Promise<Command[COMMAND_RETURN]> | Command[COMMAND_RETURN],
  ): Promise<Command[COMMAND_RETURN]> {
    // 1. Check Local Handlers (inline or provided via DI)
    const localHandler =
      handler ?? this.commandBus.getHandler(command.constructor.name);
    if (localHandler) {
      return Promise.resolve(localHandler(command, context ?? this.context));
    }

    // 2. Remote Execution via PortChannel sendRequestWithFailover
    return this.sendRequestWithFailover(
      command.constructor.name,
      command.data,
      {
        timeout: this.timeout,
        ackTimeout: this.ackTimeout,
      },
    );
  }

  // --- STREAM REGISTRATION (Incoming Requests) ---

  protected registerAsyncStream(command: Type<Command<any, any>>): void {
    const asyncHandler = this.commandBus.asyncStreamHandlers.get(command.name);
    if (!asyncHandler) throw new Error(`Stream ${command.name} not found`);

    const responseName = this.getResponseName(command.name);
    const unsubscriptions = new Map<string, () => void>();
    const unsubscribeName = this.getUnsubscribeName(command.name);

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
        const ackName = this.getAckName(command.name);
        this.publish(ackName, { id: commandData.id } as CommandAckEvent, {
          singleConsumer: true,
          target: dataEvent.source,
        });

        let unsubscribed = false;
        const cmd = this.getCommandInstance(command.name, commandData.data);
        const meta: PortChannelPluginMetadata = { commandData, dataEvent };

        const iterator = asyncHandler(cmd, this.context, meta);

        if (!unsubscriptions.has(commandData.id)) {
          unsubscriptions.set(commandData.id, () => {
            unsubscribed = true;
            try {
              iterator.return?.();
            } catch {
              // ignore
            }
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
    if (this.commandBus.asyncStreamHandlers.has(command.name)) {
      return this.registerAsyncStream(command);
    }

    if (!this.commandBus.hasLocalStreamHandler(command.name)) {
      throw new Error(`Stream ${command.name} not found`);
    }

    const responseName = this.getResponseName(command.name);
    const subscription = (
      commandData: CommandDataEvent,
      _context: any,
      dataEvent: DataEvent,
    ) => {
      const ackName = this.getAckName(command.name);
      this.publish(ackName, { id: commandData.id } as CommandAckEvent, {
        singleConsumer: true,
        target: dataEvent.source,
      });

      const unsubscribeName = this.getUnsubscribeName(command.name);
      let unsubscribed = false;
      const cmd = this.getCommandInstance(command.name, commandData.data);

      const unsubscribe = this.commandBus.executeLocalStream(
        cmd,
        (data: any, done: boolean, error?: any) => {
          if (unsubscribed) return;
          this.publish(
            responseName,
            { id: commandData.id, data, done, error } as CommandResponseEvent,
            { singleConsumer: true, target: dataEvent.source },
          );
          if (done) {
            unsubscribed = true;
          }
        },
        this.context,
      );

      this.subscribe(unsubscribeName, (uData: CommandUnsubscribeEvent) => {
        if (uData.id === commandData.id) {
          unsubscribed = true;
          if (typeof unsubscribe === "function") {
            unsubscribe();
          }
        }
      });
    };

    this.commandSubscriptions.set(command.name, subscription);
    this.subscribe(command.name, subscription);
  }

  // --- STREAM HANDLER (Outgoing Requests) ---
  streamHandler(
    command: Command,
    context: any,
    next: (data: Command[COMMAND_RETURN], done: boolean, error?: any) => void,
    abortSignal?: AbortSignal,
  ): (() => void) | Promise<() => void> {
    const commandName = command.constructor.name;

    if (this.commandBus.hasLocalStreamHandler(commandName)) {
      return this.commandBus.executeLocalStream(
        command,
        next,
        context ?? this.context,
        abortSignal,
      );
    }

    const cancel = this.sendStreamWithFailover(
      commandName,
      command.data,
      (data, done, error) => {
        next(data, done, error);
      },
      {
        ackTimeout: this.ackTimeout,
      },
    );

    if (abortSignal) {
      abortSignal.addEventListener("abort", () => cancel(), { once: true });
    }

    return cancel;
  }
}
