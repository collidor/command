export function getConstructor<T = any>(obj: T): any {
    return Object.getPrototypeOf(obj)?.constructor
}

export const isFunction = (fn: any): boolean => typeof fn === 'function'
