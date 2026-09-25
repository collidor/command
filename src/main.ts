export { Command, COMMAND_RETURN } from "./commandModel.ts";
export { CommandBus } from "./commandBus.ts";
export {
  CommandHistoryManager,
  globalCommandHistory,
  getGlobalCommandHistory,
  resetGlobalCommandHistory,
  type CommandHistoryEntry,
  type CommandHistoryManagerOptions,
  type ExecuteCommandOptions,
} from "./commandHistoryManager.ts";

export type {
  AsyncCommandBusPlugin,
  AsyncPluginHandler,
  AvailabilityChangeOptions,
  BasePlugin,
  CommandBusOptions,
  CommandBusPlugin,
  CommandHandlerFunction,
  CommandHandlerInstance,
  CommandHandlerProvider,
  PluginHandler,
  StreamPluginHandler,
  Type,
  WaitForOptions,
} from "./commandBusTypes.ts";

export { BaseCommandBus } from "./baseCommandBus.ts";

export { AsyncCommandBus } from "./asyncCommandBus.ts";

export {
  type CommandSerializer,
  httpClientPlugin,
  httpServerPlugin,
} from "./plugins/httpPlugin.ts";

export {
  PortChannelPlugin,
  type PortChannelPluginOptions,
} from "./plugins/portChannelPlugin.ts";

export {
  createWindowCustomEventMessageChannel,
  type WindowCustomEventBridge,
  WindowCustomEventMessageChannel,
  WindowCustomEventPlugin,
  type WindowCustomEventPluginOptions,
  WindowCustomEventPort,
  type WindowCustomEventPortOptions,
  windowCustomEventPlugin,
} from "./plugins/windowCustomEventPlugin.ts";

