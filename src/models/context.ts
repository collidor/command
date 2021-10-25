import { CommandBusBase, CommandType, Options } from '..'

export class CommandContext<O extends Options = Options> {
    public execute!: CommandBusBase<O>['execute']
    public commands: Set<CommandType> = new Set()
}
