import { RESULT_TYPE } from '../constants'

export abstract class Command<T = any> {
    /** Symbol that stores the resulting type */
    public [RESULT_TYPE]: T
}
