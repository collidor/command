import { ResultType } from '../constants'
import { CommandType } from '../models/command'
import { CommandContext } from '../models/context'

export interface ICommandHandler<
    T extends CommandType = CommandType,
    C extends CommandContext = CommandContext,
> {
    execute(command: T, context?: C): T[ResultType]
}
