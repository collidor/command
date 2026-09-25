import type { Command, COMMAND_RETURN } from "./commandModel.ts";

export type Type<T> = new (...args: any[]) => T;
type ContextType = Record<string, any>;

// --- Stream Types (Shared) ---
export type StreamPluginHandler<
  C extends Command,
  TContext extends ContextType = ContextType,
> = (
  command: C,
  context: TContext,
  next: (data: C[COMMAND_RETURN], done: boolean, error?: any) => void,
  abortSignal?: AbortSignal,
) => (() => void) | Promise<() => void>;

export type AvailabilityChangeOptions = {
  immediate?: boolean;
};

export type WaitForOptions = {
  timeout?: number;
  signal?: AbortSignal;
};

// --- Plugin Base Definition ---
export interface BasePlugin<TContext extends ContextType> {
  install?: (commandBus: any, context: TContext) => void;
  register?: (Command: Type<Command>) => void;
  registerStream?: (Command: Type<Command>) => void;
  unregister?: (Command: Type<Command> | string) => void;
  streamHandler?: StreamPluginHandler<any, TContext>;
  isAvailable?: (commandName: string) => boolean;
  getAvailableCommands?: () => string[];
  onAvailabilityChange?: (
    callback: (commandName: string, isAvailable: boolean) => void,
  ) => () => void;
}

// --- Sync Specific Types ---
export type PluginHandler<C extends Command, TContext extends ContextType> = (
  command: C,
  context: TContext,
  handler?: (
    command: C,
    context: TContext,
    meta?: Record<string, any>,
  ) => C[COMMAND_RETURN],
) => C[COMMAND_RETURN];

export interface CommandBusPlugin<
  C extends Command = Command,
  TContext extends ContextType = ContextType,
> extends BasePlugin<TContext> {
  handler?: PluginHandler<C, TContext>;
}

// --- Async Specific Types ---
export type AsyncPluginHandler<
  C extends Command,
  TContext extends ContextType,
> = (
  command: C,
  context: TContext,
  handler?: (
    command: C,
    context: TContext,
  ) => Promise<C[COMMAND_RETURN]> | C[COMMAND_RETURN],
) => Promise<C[COMMAND_RETURN]>;

export interface AsyncCommandBusPlugin<
  C extends Command = Command,
  TContext extends ContextType = ContextType,
> extends BasePlugin<TContext> {
  handler?: AsyncPluginHandler<C, TContext>;
}

export type CommandHandlerInstance<
  C extends Command = Command,
  TContext extends ContextType = ContextType,
> = {
  execute?: (
    command: C,
    context?: TContext,
    meta?: Record<string, any>,
  ) => Promise<C[COMMAND_RETURN]> | C[COMMAND_RETURN];
  stream?: (
    command: C,
    context: TContext,
    next: (data: C[COMMAND_RETURN], done: boolean, error?: any) => void,
    meta?: Record<string, any>,
  ) => (() => void) | Promise<() => void> | void;
  streamAsync?: (
    command: C,
    context?: TContext,
    meta?: Record<string, any>,
  ) => AsyncIterable<C[COMMAND_RETURN]>;
};

export type CommandHandlerFunction<
  C extends Command = Command,
  TContext extends ContextType = ContextType,
> = (
  command: C,
  context?: TContext,
  meta?: Record<string, any>,
) => Promise<C[COMMAND_RETURN]> | C[COMMAND_RETURN];

export type CommandHandlerProvider<
  TContext extends ContextType = ContextType,
> = (
  commandType: Type<Command>,
  context?: TContext,
) =>
  | CommandHandlerInstance<any, TContext>
  | CommandHandlerFunction<any, TContext>
  | undefined
  | null;

export interface CommandBusOptions<
  TContext extends ContextType,
  TPlugin extends BasePlugin<TContext> | undefined,
> {
  context?: TContext;
  plugin?: TPlugin;
  provider?: CommandHandlerProvider<TContext>;
}
