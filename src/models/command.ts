import { Observable } from 'rxjs'

import { RESULT_TYPE } from '../constants'

export abstract class Command<T = any> {
    /** Symbol that stores the resulting type */
    public [RESULT_TYPE]: T
}

export abstract class AsyncCommand<T = any> extends Command<Promise<T>> {}

export abstract class ObservableCommand<T = any> extends Command<Observable<T>> {}
