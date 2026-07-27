export type HeartbeatDeliveryResult = "accepted" | "stop";

/**
 * Sends heartbeat evidence one request at a time.
 *
 * The sequence is allocated only when an item reaches the head of the queue,
 * so a slow request cannot let a later request overtake it and create a
 * permanent server-side sequence gap.
 */
export class SequentialHeartbeatQueue<T> {
  private pending: T[] = [];
  private draining = false;
  private stopped = false;
  private generation = 0;
  private lastAcceptedSequence: number;

  constructor(
    initialSequence: number,
    private readonly deliver: (
      item: T,
      sequence: number,
    ) => Promise<HeartbeatDeliveryResult>,
  ) {
    this.lastAcceptedSequence = initialSequence;
  }

  enqueue(item: T): boolean {
    if (this.stopped) return false;
    this.pending.push(item);
    void this.drain();
    return true;
  }

  /**
   * Drops evidence that was captured before a newly issued server challenge.
   * The in-flight request, if any, still owns its sequence.
   */
  clearPending(): void {
    this.pending = [];
  }

  /**
   * Starts a new server lease. An old in-flight response is ignored through
   * the generation fence and can never advance the new lease sequence.
   */
  reset(initialSequence = 0): void {
    this.generation += 1;
    this.pending = [];
    this.stopped = false;
    this.lastAcceptedSequence = initialSequence;
    if (!this.draining) void this.drain();
  }

  stop(): void {
    this.generation += 1;
    this.pending = [];
    this.stopped = true;
  }

  get lastSequence(): number {
    return this.lastAcceptedSequence;
  }

  private async drain(): Promise<void> {
    if (this.draining || this.stopped) return;
    this.draining = true;
    const runGeneration = this.generation;
    try {
      while (
        !this.stopped &&
        this.generation === runGeneration &&
        this.pending.length > 0
      ) {
        const item = this.pending.shift()!;
        const sequence = this.lastAcceptedSequence + 1;
        let result: HeartbeatDeliveryResult;
        try {
          result = await this.deliver(item, sequence);
        } catch {
          result = "stop";
        }
        if (this.generation !== runGeneration) return;
        if (result !== "accepted") {
          this.stop();
          return;
        }
        this.lastAcceptedSequence = sequence;
      }
    } finally {
      this.draining = false;
      if (!this.stopped && this.pending.length > 0) {
        void this.drain();
      }
    }
  }
}
