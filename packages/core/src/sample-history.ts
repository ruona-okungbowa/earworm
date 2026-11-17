/**
 * Internal ring buffer shared by the Pitch, Spectrum and Band Detectors.
 * Not exported from the core index.
 */
export interface SampleHistory {
  readonly capacity: number;
  /** Number of samples held, never more than `capacity`. */
  readonly length: number;
  /** Appends the Frame, keeping at most the last `capacity` samples. */
  push(samples: ArrayLike<number>): void;
  /** Writes held samples oldest first into `out`, zero-filling the rest. */
  snapshot(out: Float32Array): void;
  clear(): void;
}

export function createSampleHistory(capacity: number): SampleHistory {
  const buf = new Float32Array(capacity);
  let writeIndex = 0;
  let count = 0;

  return {
    capacity,
    get length(): number {
      return count;
    },
    push(samples: ArrayLike<number>): void {
      const n = samples.length;
      const start = n > capacity ? n - capacity : 0;
      for (let i = start; i < n; i++) {
        buf[writeIndex] = samples[i] as number;
        writeIndex++;
        if (writeIndex === capacity) writeIndex = 0;
      }
      count = Math.min(capacity, count + (n - start));
    },
    snapshot(out: Float32Array): void {
      const held = Math.min(count, out.length);
      // Oldest held sample sits `count` positions behind the write index.
      let read = (writeIndex - count + capacity) % capacity;
      // If out is shorter than count, keep the newest `held` samples.
      read = (read + (count - held)) % capacity;
      for (let i = 0; i < held; i++) {
        out[i] = buf[read] as number;
        read++;
        if (read === capacity) read = 0;
      }
      out.fill(0, held);
    },
    clear(): void {
      count = 0;
      writeIndex = 0;
    },
  };
}
