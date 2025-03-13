import { CommandBus, PortChannelPlugin } from "@collidor/command";
import { GetFactorialCommand } from "./lib/commands/getFactorial.command.ts";
import { GetTimeCommand } from "./lib/commands/getTime.command.ts";

const portChannelPlugin = new PortChannelPlugin();
portChannelPlugin.addPort(self as unknown as MessagePort);

const commandBus = new CommandBus({
    plugin: portChannelPlugin,
});

commandBus.register(GetFactorialCommand, (command) => {
    const { data: input } = command;
    let result = 1;
    for (let i = 1; i <= input; i++) {
        result *= i;
    }
    return result;
});

commandBus.registerStreamAsync(GetTimeCommand, async function* () {
    while (true) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        yield Date.now();
    }
});
