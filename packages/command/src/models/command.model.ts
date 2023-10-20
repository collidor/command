export const RETURN_TYPE = Symbol('returnType')

export type ReturnType = typeof RETURN_TYPE

export abstract class Command<R = any> {
    public [RETURN_TYPE]!: R
}
