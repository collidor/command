import { Command, type COMMAND_RETURN } from "./commandModel.ts";
import { CommandBus } from "./commandBus.ts";
import type { Type } from "./commandBusTypes.ts";

export interface CommandHistoryEntry<
  TContext extends Record<string, any> = Record<string, any>,
> {
  id: string;
  forward: Command;
  inverse: Command;
  bus: CommandBus<any>;
  description?: string;
  source?: string;
  timestamp: number;
  context?: TContext;
}

export interface ExecuteCommandOptions<
  TContext extends Record<string, any> = Record<string, any>,
> {
  bus?: CommandBus<any>;
  context?: TContext;
  description?: string;
  source?: string;
}

export interface CommandHistoryManagerOptions<
  TContext extends Record<string, any> = Record<string, any>,
> {
  bus?: CommandBus<TContext>;
  context?: TContext;
  maxHistory?: number;
}

export class CommandHistoryManager<
  TContext extends Record<string, any> = Record<string, any>,
> {
  public defaultBus: CommandBus<TContext>;
  public context: TContext;
  public maxHistory: number;

  private buses: Map<string, CommandBus<any>> = new Map();
  private undoStack: CommandHistoryEntry<any>[] = [];
  private redoStack: CommandHistoryEntry<any>[] = [];
  private listeners: Set<() => void> = new Set();
  private batchStack: CommandHistoryEntry<any>[] | null = null;
  private batchName: string | null = null;

  constructor(options?: CommandHistoryManagerOptions<TContext>) {
    this.context = options?.context || ({} as TContext);
    this.defaultBus = options?.bus || new CommandBus<TContext>({ context: this.context });
    this.maxHistory = options?.maxHistory ?? 10;
    this.registerBus(this.defaultBus, "default");
  }

  public get bus(): CommandBus<TContext> {
    return this.defaultBus;
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public get undoCount(): number {
    return this.undoStack.length;
  }

  public get redoCount(): number {
    return this.redoStack.length;
  }

  public registerBus(bus: CommandBus<any>, name?: string): () => void {
    const key = name || `bus_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.buses.set(key, bus);
    return () => {
      this.buses.delete(key);
    };
  }

  public getBus(name: string): CommandBus<any> | undefined {
    return this.buses.get(name);
  }

  public getAllBuses(): CommandBus<any>[] {
    return Array.from(this.buses.values());
  }

  public setMaxHistory(max: number): void {
    this.maxHistory = Math.max(1, max);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack = this.undoStack.slice(this.undoStack.length - this.maxHistory);
    }
    if (this.redoStack.length > this.maxHistory) {
      this.redoStack = this.redoStack.slice(this.redoStack.length - this.maxHistory);
    }
    this.notify();
  }

  public getMaxHistory(): number {
    return this.maxHistory;
  }

  public register<C extends Command>(
    command: Type<C>,
    handler: (
      command: C,
      context: TContext,
      meta?: Record<string, any>,
    ) => C[COMMAND_RETURN],
    targetBus?: CommandBus<any>,
  ): void {
    const b = targetBus ?? this.defaultBus;
    b.register(command, handler);
  }

  public execute<C extends Command, I extends Command>(
    command: C,
    inverse: I | ((result: C[COMMAND_RETURN]) => I),
    optionsOrContext?: TContext | ExecuteCommandOptions<TContext>,
    description?: string,
  ): C[COMMAND_RETURN] {
    let targetBus = this.defaultBus;
    let ctx = this.context;
    let desc = description || command.constructor.name;
    let source: string | undefined;

    if (optionsOrContext && typeof optionsOrContext === "object") {
      if (
        "bus" in optionsOrContext ||
        "context" in optionsOrContext ||
        "description" in optionsOrContext ||
        "source" in optionsOrContext
      ) {
        const opts = optionsOrContext as ExecuteCommandOptions<TContext>;
        if (opts.bus) targetBus = opts.bus;
        if (opts.context) ctx = opts.context;
        if (opts.description) desc = opts.description;
        if (opts.source) source = opts.source;
      } else {
        ctx = optionsOrContext as TContext;
      }
    }

    const result = targetBus.execute(command, ctx);
    const inverseCmd =
      typeof inverse === "function" ? (inverse as (r: any) => I)(result) : inverse;

    const entry: CommandHistoryEntry<TContext> = {
      id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      forward: command,
      inverse: inverseCmd,
      bus: targetBus,
      description: desc,
      source,
      timestamp: Date.now(),
      context: ctx,
    };

    if (this.batchStack !== null) {
      this.batchStack.push(entry);
    } else {
      this.pushUndo(entry);
      this.redoStack = [];
      this.notify();
    }

    return result;
  }

  public undo(context?: TContext): CommandHistoryEntry<any> | null {
    if (!this.canUndo) return null;

    const entry = this.undoStack.pop();
    if (!entry) return null;

    const ctx = context ?? entry.context ?? this.context;
    entry.bus.execute(entry.inverse, ctx);

    this.pushRedo(entry);
    this.notify();
    return entry;
  }

  public redo(context?: TContext): CommandHistoryEntry<any> | null {
    if (!this.canRedo) return null;

    const entry = this.redoStack.pop();
    if (!entry) return null;

    const ctx = context ?? entry.context ?? this.context;
    entry.bus.execute(entry.forward, ctx);

    this.pushUndo(entry);
    this.notify();
    return entry;
  }

  public beginBatch(name?: string): void {
    this.batchStack = [];
    this.batchName = name || "Batch Command";
  }

  public endBatch(): void {
    if (!this.batchStack || this.batchStack.length === 0) {
      this.batchStack = null;
      this.batchName = null;
      return;
    }

    const batchEntries = [...this.batchStack];
    const defaultTargetBus = batchEntries[0]?.bus || this.defaultBus;

    const compoundForward = new BatchCompositeCommand(
      batchEntries.map((e) => ({ cmd: e.forward, bus: e.bus })),
    );
    const compoundInverse = new BatchCompositeCommand(
      [...batchEntries].reverse().map((e) => ({ cmd: e.inverse, bus: e.bus })),
    );

    for (const b of this.getAllBuses()) {
      if (!b.handlers.has(BatchCompositeCommand.name)) {
        b.register(BatchCompositeCommand, (cmd: BatchCompositeCommand, ctx: any) => {
          for (const item of cmd.data) {
            item.bus.execute(item.cmd, ctx);
          }
        });
      }
    }

    const compoundEntry: CommandHistoryEntry<TContext> = {
      id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      forward: compoundForward,
      inverse: compoundInverse,
      bus: defaultTargetBus,
      description: this.batchName || `Batch of ${batchEntries.length} commands`,
      timestamp: Date.now(),
      context: this.context,
    };

    this.batchStack = null;
    this.batchName = null;

    this.pushUndo(compoundEntry);
    this.redoStack = [];
    this.notify();
  }

  public cancelBatch(): void {
    this.batchStack = null;
    this.batchName = null;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.batchStack = null;
    this.notify();
  }

  public getHistory(): {
    undo: CommandHistoryEntry<any>[];
    redo: CommandHistoryEntry<any>[];
  } {
    return {
      undo: [...this.undoStack],
      redo: [...this.redoStack],
    };
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private pushUndo(entry: CommandHistoryEntry<any>): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack = this.undoStack.slice(this.undoStack.length - this.maxHistory);
    }
  }

  private pushRedo(entry: CommandHistoryEntry<any>): void {
    this.redoStack.push(entry);
    if (this.redoStack.length > this.maxHistory) {
      this.redoStack = this.redoStack.slice(this.redoStack.length - this.maxHistory);
    }
  }

  private notify(): void {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (e) {
        // deno-lint-ignore no-console
        console.error("Error in CommandHistoryManager listener:", e);
      }
    });
  }
}

class BatchCompositeCommand extends Command<
  Array<{ cmd: Command; bus: CommandBus<any> }>,
  void
> {
  constructor(items: Array<{ cmd: Command; bus: CommandBus<any> }>) {
    super(items);
  }
}

export const globalCommandHistory: CommandHistoryManager =
  new CommandHistoryManager();

export function getGlobalCommandHistory(): CommandHistoryManager {
  return globalCommandHistory;
}

export function resetGlobalCommandHistory(): void {
  globalCommandHistory.clear();
}
