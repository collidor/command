import { Observable } from 'rxjs'

import { RESULT_TYPE } from '../constants'

/** Base command */
export abstract class BaseCommand<T = any> {
    /** Symbol that stores the resulting type */
    public [RESULT_TYPE]: T
}

export type UndoableResult<T = any, Q = any> = Observable<[T, () => Promise<Q>]>

export type UndoableHandlerResult<T = any, Q = any> = {
    value: Observable<T>
    undo?: () => Promise<Q>
}

/** A command which will return a promise with the result*/
export abstract class Command<T> extends BaseCommand<Observable<T>> {}

export abstract class UndoableCommand<T, Q = any> extends BaseCommand<UndoableResult<T, Q>> {}

// /** A command which will return an observable with the results sent over time */
// export abstract class ObservableCommand<T> extends BaseCommand<Observable<T>> {}

// export abstract class UndoableObservableCommand<T, Q = any> extends BaseCommand<
//     UndoableResult<Observable<T>, Q>
// > {}

export type CommandType<T = any> = Command<T> | UndoableCommand<T>
// | ObservableCommand<T>
// | UndoableObservableCommand<T>
