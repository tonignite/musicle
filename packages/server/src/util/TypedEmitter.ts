import { EventEmitter } from 'node:events';

/**
 * Thin typed wrapper over Node's EventEmitter. Keeps event names and payload
 * tuples type-checked without depending on @types/node's (version-dependent)
 * generic EventEmitter support.
 */
export class TypedEmitter<E extends Record<string, unknown[]>> {
  private readonly emitter = new EventEmitter();

  on<K extends keyof E & string>(event: K, listener: (...args: E[K]) => void): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof E & string>(event: K, listener: (...args: E[K]) => void): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  emit<K extends keyof E & string>(event: K, ...args: E[K]): boolean {
    return this.emitter.emit(event, ...args);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
