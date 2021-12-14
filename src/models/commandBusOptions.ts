import { IType } from '../interfaces/type.interface'

export class CommandBusOptions {
    public name?: string
    public injectionResolver: <T = any>(constructor: IType<T>) => T = (constructor) =>
        new constructor()

    constructor(options?: CommandBusOptions) {
        if (options) {
            Object.assign(this, options)
        }
    }
}
