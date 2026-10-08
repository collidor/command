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

  /** Per-command teardown of stream bookkeeping (unsubscribe listener, in-flight streams). */
  protected commandCleanups: Map<string, () => void> = new Map();

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
    const tracked = this.commandSubscriptions.has(commandName);
    this.disposeCommand(commandName);
    if (!tracked) {
      (this.unsubscribe as any)(commandName);
    }
  }

  /**
   * Drops everything previously set up for a command so that registering it
   * again (or unregistering it) never leaves stale listeners behind.
   */
  protected disposeCommand(commandName: string): void {
    const callback = this.commandSubscriptions.get(commandName);
    if (callback) {
      this.unsubscribe(commandName, callback as any);
      this.commandSubscriptions.delete(commandName);
    }
    const cleanup = this.commandCleanups.get(commandName);
    if (cleanup) {
      this.commandCleanups.delete(commandName);
      cleanup();
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

    this.disposeCommand(command.name);
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

  /**
   * Tracks the streams currently served for one command and routes the
   * (single) unsubscribe listener to them.
   */
  protected createStreamRegistry(commandName: string): {
    active: Map<string, { stop: () => void; close: () => void }>;
    unsubscribeName: string;
  } {
    const unsubscribeName = this.getUnsubscribeName(commandName);
    const active = new Map<string, { stop: () => void; close: () => void }>();

    const onUnsubscribe = (unsubscribeData: CommandUnsubscribeEvent) => {
      const entry = active.get(unsubscribeData.id);
      if (entry) {
        active.delete(unsubscribeData.id);
        entry.stop();
      }
    };
    this.subscribe(unsubscribeName, onUnsubscribe);

    this.commandCleanups.set(commandName, () => {
      this.unsubscribe(unsubscribeName, onUnsubscribe as any);
      const entries = Array.from(active.values());
      active.clear();
      // Tell in-flight consumers the stream is over instead of leaving them hanging.
      for (const entry of entries) entry.close();
    });

    return { active, unsubscribeName };
  }

  protected registerAsyncStream(command: Type<Command<any, any>>): void {
    const asyncHandler = this.commandBus.asyncStreamHandlers.get(command.name);
    if (!asyncHandler) throw new Error(`Stream ${command.name} not found`);

    this.disposeCommand(command.name);

    const responseName = this.getResponseName(command.name);
    const { active, unsubscribeName } = this.createStreamRegistry(command.name);

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

      const publishFrame = (
        data: any,
        done: boolean,
        error?: any,
      ) =>
        this.publish(
          responseName,
          { id: commandData.id, data, done, error } as CommandResponseEvent,
          { singleConsumer: true, target: dataEvent.source },
        );

      let unsubscribed = false;
      let iterator: AsyncIterator<any> | undefined;

      const release = () => {
        unsubscribed = true;
        active.delete(commandData.id);
        try {
          Promise.resolve(iterator?.return?.()).catch(() => {});
        } catch {
          // ignore
        }
      };
      // Client asked to stop: close the iterator and echo the unsubscribe back.
      const stop = () => {
        if (unsubscribed) return;
        release();
        this.publish(
          unsubscribeName,
          { id: commandData.id } as CommandUnsubscribeEvent,
          { singleConsumer: true, target: dataEvent.source },
        );
      };
      // Server side ending (e.g. unregister): the done frame is all the client
      // needs. It drops its own subscription on it, so an unsubscribe event
      // would have no listener and only sit in the channel's event buffer.
      const close = () => {
        if (unsubscribed) return;
        publishFrame(null, true);
        release();
      };

      const pump = async () => {
        try {
          const cmd = this.getCommandInstance(command.name, commandData.data);
          const meta: PortChannelPluginMetadata = { commandData, dataEvent };
          const iterable: any = asyncHandler(cmd, this.context, meta);
          iterator = typeof iterable?.next === "function"
            ? iterable
            : iterable[Symbol.asyncIterator]();

          while (!unsubscribed) {
            const current = await iterator!.next();
            if (unsubscribed) return;
            publishFrame(current.value, current.done ?? false);
            if (current.done) break;
          }
        } catch (error) {
          if (!unsubscribed) publishFrame(null, true, error);
        } finally {
          unsubscribed = true;
          active.delete(commandData.id);
        }
      };

      active.set(commandData.id, { stop, close });
      void pump();
    };

    this.commandSubscriptions.set(command.name, subscription);
    this.subscribe(command.name, subscription);
  }

  registerStream(command: Type<Command<any, any>>): void {
    if (this.commandBus.asyncStreamHandlers.has(command.name)) {
      return this.registerAsyncStream(command);
    }

    if (!this.commandBus.hasLocalStreamHandler(command.name)) {
      throw new Error(`Stream ${command.name} not found`);
    }

    this.disposeCommand(command.name);

    const responseName = this.getResponseName(command.name);
    const { active } = this.createStreamRegistry(command.name);

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

      const publishFrame = (data: any, done: boolean, error?: any) =>
        this.publish(
          responseName,
          { id: commandData.id, data, done, error } as CommandResponseEvent,
          { singleConsumer: true, target: dataEvent.source },
        );

      let unsubscribed = false;
      try {
        const cmd = this.getCommandInstance(command.name, commandData.data);

        const unsubscribe = this.commandBus.executeLocalStream(
          cmd,
          (data: any, done: boolean, error?: any) => {
            if (unsubscribed) return;
            if (done) {
              unsubscribed = true;
              active.delete(commandData.id);
            }
            publishFrame(data, done, error);
          },
          this.context,
        );

        if (!unsubscribed) {
          const stop = () => {
            if (unsubscribed) return;
            unsubscribed = true;
            active.delete(commandData.id);
            unsubscribe();
          };
          active.set(commandData.id, {
            stop,
            close: () => {
              if (unsubscribed) return;
              stop();
              publishFrame(null, true);
            },
          });
        }
      } catch (error) {
        // Setup failed: report it instead of leaving the remote caller waiting.
        if (!unsubscribed) {
          unsubscribed = true;
          publishFrame(null, true, error);
        }
      }
    };

    this.commandSubscriptions.set(command.name, subscription);
    this.subscribe(command.name, subscription);
  }

  // --- STREAM HANDLER (Outgoing Requests) ---
  // Abort handling is owned by the bus (it calls the returned cancel function
  // when the signal fires), so the signal is deliberately not wired up here.
  streamHandler(
    command: Command,
    context: any,
    next: (data: Command[COMMAND_RETURN], done: boolean, error?: any) => void,
    _abortSignal?: AbortSignal,
  ): (() => void) | Promise<() => void> {
    const commandName = command.constructor.name;

    if (this.commandBus.hasLocalStreamHandler(commandName)) {
      return this.commandBus.executeLocalStream(
        command,
        next,
        context ?? this.context,
      );
    }

    return this.sendStreamWithFailover(
      commandName,
      command.data,
      (data, done, error) => {
        next(data, done, error);
      },
      {
        ackTimeout: this.ackTimeout,
      },
    );
  }
}
