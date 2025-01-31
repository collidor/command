export const COMMAND_RETURN = Symbol('returnType');

export type COMMAND_RETURN = typeof COMMAND_RETURN;

export abstract class Command<R = unknown> {
    public [COMMAND_RETURN]!: R;
}
