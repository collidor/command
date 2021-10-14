import { Observable } from 'rxjs'

import { RESULT_TYPE } from '../constants'

/** Base command */
export class BaseCommand<T = any> {
    /** Symbol that stores the resulting type */
    public [RESULT_TYPE]: T
}

/** A command which will return a promise with the result*/
export class Command<T> extends BaseCommand<Promise<T>> {}

/** A command which will return an observable with the results sent over time */
export class ObservableCommand<T> extends BaseCommand<Observable<T>> {}

export type CommandType<T = any> = Command<T> | ObservableCommand<T> | BaseCommand<T>
