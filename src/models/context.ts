import { CommandBusBase, CommandType } from '..'

export class CommandContext {
    public execute!: CommandBusBase['execute']
    public commands: Set<CommandType> = new Set()
}
