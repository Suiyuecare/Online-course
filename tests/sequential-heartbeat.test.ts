import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SequentialHeartbeatQueue } from "@/domain/sequential-heartbeat";

async function eventually(assertion: () => void) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await Promise.resolve();
    }
  }
  assertion();
}

describe("SequentialHeartbeatQueue", () => {
  it("never overlaps delivery or skips a sequence", async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    const delivered: number[] = [];
    const queue = new SequentialHeartbeatQueue<string>(
      7,
      async (_item, sequence) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        delivered.push(sequence);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return "accepted";
      },
    );

    queue.enqueue("first");
    queue.enqueue("second");
    queue.enqueue("third");
    await eventually(() => expect(delivered).toEqual([8]));
    releases.shift()!();
    await eventually(() => expect(delivered).toEqual([8, 9]));
    releases.shift()!();
    await eventually(() => expect(delivered).toEqual([8, 9, 10]));
    releases.shift()!();
    await eventually(() => expect(queue.lastSequence).toBe(10));
    expect(maximumActive).toBe(1);
  });

  it("stops after an ambiguous or rejected delivery", async () => {
    const deliver = vi
      .fn()
      .mockResolvedValueOnce("stop")
      .mockResolvedValue("accepted");
    const queue = new SequentialHeartbeatQueue<string>(0, deliver);

    queue.enqueue("ambiguous");
    queue.enqueue("must-not-send");
    await eventually(() => expect(deliver).toHaveBeenCalledTimes(1));
    expect(queue.enqueue("also-blocked")).toBe(false);
    expect(queue.lastSequence).toBe(0);
  });

  it("fences an old in-flight response when a new lease resets sequence", async () => {
    let releaseOld!: () => void;
    const delivered: Array<[string, number]> = [];
    const queue = new SequentialHeartbeatQueue<string>(
      12,
      async (item, sequence) => {
        delivered.push([item, sequence]);
        if (item === "old") {
          await new Promise<void>((resolve) => {
            releaseOld = resolve;
          });
        }
        return "accepted";
      },
    );

    queue.enqueue("old");
    await eventually(() => expect(delivered).toEqual([["old", 13]]));
    queue.reset(3);
    queue.enqueue("new");
    releaseOld();
    await eventually(() =>
      expect(delivered).toEqual([
        ["old", 13],
        ["new", 4],
      ]),
    );
    await eventually(() => expect(queue.lastSequence).toBe(4));
  });

  it("can discard stale queued snapshots without losing the in-flight sequence", async () => {
    let releaseFirst!: () => void;
    const delivered: string[] = [];
    const queue = new SequentialHeartbeatQueue<string>(0, async (item) => {
      delivered.push(item);
      if (item === "first") {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return "accepted";
    });

    queue.enqueue("first");
    queue.enqueue("captured-before-challenge");
    await eventually(() => expect(delivered).toEqual(["first"]));
    queue.clearPending();
    queue.enqueue("challenge-bound");
    releaseFirst();
    await eventually(() =>
      expect(delivered).toEqual(["first", "challenge-bound"]),
    );
    await eventually(() => expect(queue.lastSequence).toBe(2));
  });
});

describe("heartbeat browser integration", () => {
  it("records eligibility transitions immediately instead of sampling only every 15 seconds", () => {
    const classroom = readFileSync(
      join(process.cwd(), "src", "components", "recorded-classroom.tsx"),
      "utf8",
    );
    expect(classroom).toContain(
      'document.addEventListener("visibilitychange", reportVisibility)',
    );
    expect(classroom).toContain(
      'window.addEventListener("offline", reportOffline)',
    );
    expect(classroom).toContain("enqueueHeartbeat({ playing: false })");
    expect(classroom).toContain("enqueueHeartbeat({ playing: true })");
    expect(classroom).toContain("ensureHeartbeatQueue().clearPending()");
  });

  it("serializes Zoom heartbeat delivery and handles a missing response", () => {
    const classroom = readFileSync(
      join(process.cwd(), "src", "components", "zoom-classroom.tsx"),
      "utf8",
    );
    expect(classroom).toContain(
      "new SequentialHeartbeatQueue<LiveHeartbeatSnapshot>",
    );
    expect(classroom).toContain(
      "let a reload recover from the server's last accepted sequence",
    );
    expect(classroom).not.toContain("heartbeatSequence.current += 1");
    expect(classroom).not.toContain("window.setInterval(async () =>");
  });
});
