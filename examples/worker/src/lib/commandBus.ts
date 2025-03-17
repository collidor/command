import { CommandBus, PortChannelPlugin } from "@collidor/command";
import Worker from "../worker.ts";

const portChannelPlugin = new PortChannelPlugin();
const worker = new Worker();
portChannelPlugin.addPort(worker);

export const commandBus = new CommandBus({
    plugin: portChannelPlugin,
});
