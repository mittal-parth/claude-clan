/**
 * A push-driven async iterable, so a WebSocket command can feed an SDK query
 * that is already running. A plain array is not enough: a consumer waiting on
 * `next()` must be resolved by a later push or a follow-up order disappears.
 */
export class MessageQueue<T> implements AsyncIterable<T> {
  private readonly pending: T[] = [];
  private waiting?: (result: IteratorResult<T>) => void;
  private closed = false;

  get size(): number {
    return this.pending.length;
  }

  push(value: T): void {
    if (this.closed) {
      return;
    }
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = undefined;
      waiting({ value, done: false });
      return;
    }
    this.pending.push(value);
  }

  /** Ends the iterable, which cleanly shuts down a streaming-input query. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = undefined;
      waiting({ value: undefined as never, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.pending.length > 0) {
        yield this.pending.shift() as T;
        continue;
      }
      if (this.closed) {
        return;
      }
      const next = await new Promise<IteratorResult<T>>((resolve) => {
        this.waiting = resolve;
      });
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }
}
