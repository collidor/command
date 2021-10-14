import { CommandBus, CommandType } from '..'

export class CommandContext {
    public execute!: CommandBus['execute']
    public commands: Set<CommandType> = new Set()
}
