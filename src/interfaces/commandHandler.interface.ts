import { ResultType } from '../constants'
import { CommandType } from '../models/command'

export interface ICommandHandler<T extends CommandType = CommandType> {
    execute(command: T): T[ResultType]
}
