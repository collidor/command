import { Observable } from 'rxjs'

import { COMMAND_CONTEXT, RESULT_TYPE } from '../constants'
import { CommandContext } from './context'

/** Base command */
export abstract class BaseCommand<T = any> {
    /** Symbol that stores the resulting type */
    public [RESULT_TYPE]: T
    public [COMMAND_CONTEXT]?: CommandContext
}

export type UndoableResult<T = any, Q = any> = {
    value: T
    undo?: () => Promise<Q>
}

/** A command which will return a promise with the result*/
export abstract class Command<T> extends BaseCommand<Promise<T>> {}

export abstract class UndoableCommand<T, Q = any> extends BaseCommand<
    UndoableResult<Promise<T>, Q>
> {}

/** A command which will return an observable with the results sent over time */
export abstract class ObservableCommand<T> extends BaseCommand<Observable<T>> {}

export abstract class UndoableObservableCommand<T, Q = any> extends BaseCommand<
    UndoableResult<Observable<T>, Q>
> {}

export type CommandType<T = any> =
    | Command<T>
    | ObservableCommand<T>
    | UndoableCommand<T>
    | UndoableObservableCommand<T>
