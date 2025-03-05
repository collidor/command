import { CommandBus, PortChannelPlugin } from "@collidor/command";
import Worker from "../worker?worker";

const portChannelPlugin = new PortChannelPlugin();
const worker = new Worker();
portChannelPlugin.addPort(worker);

export const commandBus = new CommandBus({
    plugin: portChannelPlugin,
});
