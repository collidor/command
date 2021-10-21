import { Observable } from 'rxjs'

import { CommandType } from '..'
import { ResultType } from '../constants'

export interface CommandResult<T extends CommandType = CommandType> {
    value: T[ResultType]
    undo?: <Q = any>() => T[ResultType] extends Observable<Q>
        ? Observable<Q>
        : T[ResultType] extends Promise<Q>
        ? Promise<Q>
        : Q
}
