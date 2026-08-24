type Listener = (...args: any[]) => void;

export default class EventEmitter {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn: Listener): this {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach(fn => fn(...args));
  }
}
