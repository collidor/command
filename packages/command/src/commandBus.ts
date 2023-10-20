import { Command, ReturnType } from './models/command.model'

export class CommandBus<CommandBase extends Command = Command> {
    private readonly handlers = new Map<string, (command: CommandBase) => any>()

    public run<C extends CommandBase>(command: C): C[ReturnType] {
        const commandName = Object.getPrototypeOf(command).constructor.name
        const handler = this.handlers.get(commandName)
        if (!handler) {
            throw new Error(`No handler registered for command ${commandName}`)
        }
        return handler(command)
    }

    public handler<
        C extends CommandBase,
        This extends { execute: (arg: C) => C[ReturnType] },
        Args extends any[],
        HandlerArgs extends any[],
        Target extends new (...args: HandlerArgs) => This,
    >(
        command: new (...args: Args) => C,
    ): (target: Target, context: ClassDecoratorContext) => new (...args: HandlerArgs) => This {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const _this = this

        return (target: Target) => {
            const wrapper = function (...args: HandlerArgs) {
                const instance = new target(...args)
                _this.handlers.set(
                    command.name,
                    instance.execute.bind(instance) as (arc: CommandBase) => any,
                )
                console.log(_this.handlers)
                return instance
            }

            wrapper.prototype = target.prototype

            return wrapper as unknown as new (...args: HandlerArgs) => This
        }
    }
}
