import { ResultType } from '../constants'
import { CommandType } from '../models/comand'

export interface ICommandHandler<T extends CommandType = CommandType> {
    execute(command: T): T[ResultType]
}
