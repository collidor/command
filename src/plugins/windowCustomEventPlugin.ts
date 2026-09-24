import type { MessagePortLike } from "@collidor/event";
import {
  PortChannelPlugin,
  type PortChannelPluginOptions,
} from "./portChannelPlugin.ts";

export interface WindowCustomEventPortOptions {
  /** The event name for the CustomEvent. Defaults to "collidor:message" */
  eventName?: string;
  /** The target EventTarget to dispatch/listen on. Defaults to globalThis.window ?? globalThis */
  target?: EventTarget;
  /** Unique ID for this port instance. Defaults to crypto.randomUUID() */
  id?: string;
  /** Optional target peer port ID to restrict communication */
  peerId?: string;
  /** Optional serializer for outgoing message data */
  serializer?: (data: unknown) => unknown;
  /** Optional parser for incoming message data */
  parser?: (data: unknown) => unknown;
}

export interface WindowCustomEventPayload {
  source: string;
  target?: string;
  data: unknown;
}

export interface WindowCustomEventBridge {
  port: WindowCustomEventPort;
  disconnect: () => void;
}

export class WindowCustomEventPort extends EventTarget implements MessagePortLike {
  public readonly id: string;
  public readonly peerId?: string;
  public readonly eventName: string;
  public readonly target: EventTarget;
  public readonly options: WindowCustomEventPortOptions;

  public onmessage: ((ev: MessageEvent) => void) | null = null;
  public onmessageerror: ((ev: MessageEvent) => void) | null = null;

  private isClosed = false;

  constructor(options?: string | WindowCustomEventPortOptions) {
    super();
    const opts: WindowCustomEventPortOptions = typeof options === "string"
      ? { eventName: options }
      : (options ?? {});

    this.options = opts;
    this.id = opts.id ?? crypto.randomUUID();
    this.peerId = opts.peerId;
    this.eventName = opts.eventName ?? "collidor:message";

    if (opts.target) {
      this.target = opts.target;
    } else if (typeof window !== "undefined") {
      this.target = window;
    } else if (
      typeof globalThis !== "undefined" &&
      typeof (globalThis as unknown as EventTarget).addEventListener === "function"
    ) {
      this.target = globalThis as unknown as EventTarget;
    } else {
      this.target = new EventTarget();
    }

    this.target.addEventListener(
      this.eventName,
      this.handleCustomEvent as EventListener,
    );

    if (
      typeof globalThis !== "undefined" &&
      typeof globalThis.addEventListener === "function"
    ) {
      globalThis.addEventListener("pagehide", this.handleUnload);
      globalThis.addEventListener("beforeunload", this.handleUnload);
    }
  }

  private handleUnload = (): void => {
    this.close();
  };

  private handleCustomEvent = (event: Event): void => {
    if (this.isClosed) return;

    const customEvent = event as CustomEvent;
    const detail = customEvent.detail as WindowCustomEventPayload | undefined;

    let data: unknown;

    if (detail && typeof detail === "object" && "source" in detail) {
      if (detail.source === this.id) {
        return;
      }
      if (this.peerId && detail.source !== this.peerId) {
        return;
      }
      if (detail.target && detail.target !== this.id) {
        return;
      }
      data = detail.data;
    } else {
      data = detail;
    }

    try {
      const parsedData = this.options.parser ? this.options.parser(data) : data;
      this.dispatchMessage(parsedData);
    } catch (error) {
      this.dispatchMessageError(error);
    }
  };

  private dispatchMessage(data: unknown): void {
    const messageEvent = new MessageEvent("message", {
      data,
      ports: [],
    });

    if (this.onmessage) {
      try {
        this.onmessage(messageEvent);
      } catch (error) {
        this.dispatchMessageError(error);
        return;
      }
    }

    this.dispatchEvent(messageEvent);
  }

  private dispatchMessageError(error: unknown): void {
    const errorEvent = new MessageEvent("messageerror", {
      data: error,
    });

    if (this.onmessageerror) {
      this.onmessageerror(errorEvent);
    }

    this.dispatchEvent(errorEvent);
  }

  public postMessage(message: unknown): void {
    if (this.isClosed) {
      return;
    }

    const data = this.options.serializer ? this.options.serializer(message) : message;

    const payload: WindowCustomEventPayload = {
      source: this.id,
      target: this.peerId,
      data,
    };

    const customEvent = new CustomEvent(this.eventName, {
      detail: payload,
      bubbles: true,
      composed: true,
    });

    this.target.dispatchEvent(customEvent);
  }

  public start(): void {
    // MessagePort compatibility
  }

  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;

    try {
      const closePayload: WindowCustomEventPayload = {
        source: this.id,
        target: this.peerId,
        data: JSON.stringify({ type: "closeEvent", source: this.id }),
      };
      this.target.dispatchEvent(
        new CustomEvent(this.eventName, {
          detail: closePayload,
          bubbles: true,
          composed: true,
        }),
      );
    } catch {
      // ignore
    }

    this.target.removeEventListener(
      this.eventName,
      this.handleCustomEvent as EventListener,
    );

    if (
      typeof globalThis !== "undefined" &&
      typeof globalThis.removeEventListener === "function"
    ) {
      globalThis.removeEventListener("pagehide", this.handleUnload);
      globalThis.removeEventListener("beforeunload", this.handleUnload);
    }
  }

  public [Symbol.dispose](): void {
    this.close();
  }

  public get closed(): boolean {
    return this.isClosed;
  }

  static createBridge(
    channel: { addPort: (port: MessagePortLike) => (() => void) | void },
    options?: WindowCustomEventPortOptions | string,
  ): WindowCustomEventBridge {
    const port = new WindowCustomEventPort(options);
    const cleanup = channel.addPort(port);
    return {
      port,
      disconnect: () => {
        cleanup?.();
        port.close();
      },
    };
  }
}

export class WindowCustomEventMessageChannel {
  public readonly port1: WindowCustomEventPort;
  public readonly port2: WindowCustomEventPort;

  constructor(options?: {
    eventName?: string;
    target?: EventTarget;
    serializer?: (data: unknown) => unknown;
    parser?: (data: unknown) => unknown;
  }) {
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    const eventName = options?.eventName ?? "collidor:message";
    const target = options?.target;
    const serializer = options?.serializer;
    const parser = options?.parser;

    this.port1 = new WindowCustomEventPort({
      id: id1,
      peerId: id2,
      eventName,
      target,
      serializer,
      parser,
    });

    this.port2 = new WindowCustomEventPort({
      id: id2,
      peerId: id1,
      eventName,
      target,
      serializer,
      parser,
    });
  }
}

export function createWindowCustomEventMessageChannel(options?: {
  eventName?: string;
  target?: EventTarget;
  serializer?: (data: unknown) => unknown;
  parser?: (data: unknown) => unknown;
}): WindowCustomEventMessageChannel {
  return new WindowCustomEventMessageChannel(options);
}

export interface WindowCustomEventPluginOptions extends PortChannelPluginOptions {
  eventName?: string;
  target?: EventTarget;
  port?: MessagePortLike;
  portOptions?: WindowCustomEventPortOptions;
}

export class WindowCustomEventPlugin extends PortChannelPlugin {
  public readonly port: MessagePortLike;

  constructor(options: WindowCustomEventPluginOptions = {}) {
    super(options);
    if (options.port) {
      this.port = options.port;
    } else {
      const portOptions: WindowCustomEventPortOptions = {
        ...options.portOptions,
        ...(options.eventName ? { eventName: options.eventName } : {}),
        ...(options.target ? { target: options.target } : {}),
      };
      this.port = new WindowCustomEventPort(portOptions);
    }
    this.addPort(this.port);
  }
}

export function windowCustomEventPlugin(
  options?: WindowCustomEventPluginOptions,
): WindowCustomEventPlugin {
  return new WindowCustomEventPlugin(options);
}
