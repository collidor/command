export const COMMAND_RETURN = Symbol("returnType");

export type COMMAND_RETURN = typeof COMMAND_RETURN;

export abstract class Command<T = any, R = any> {
  public [COMMAND_RETURN]!: R;
  public data: T;
  constructor(data: T) {
    this.data = data;
  }
}
