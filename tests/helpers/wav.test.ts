import { describe, expect, it } from "vitest";
import { readWav } from "./wav";

type Encoding = "pcm16" | "pcm24" | "float32";

/** Build a WAV in memory from interleaved values in [-1, 1]. */
function buildWav(
  encoding: Encoding,
  channels: number,
  sampleRate: number,
  values: number[],
): Uint8Array {
  const bits = encoding === "pcm16" ? 16 : encoding === "pcm24" ? 24 : 32;
  const bps = bits / 8;
  const dataSize = values.length * bps;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const write = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, encoding === "float32" ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bps, true);
  view.setUint16(32, channels * bps, true);
  view.setUint16(34, bits, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);
  values.forEach((v, i) => {
    const at = 44 + i * bps;
    if (encoding === "pcm16") view.setInt16(at, Math.round(v * 32768), true);
    else if (encoding === "float32") view.setFloat32(at, v, true);
    else {
      const n = Math.round(v * 8388608) & 0xffffff;
      view.setUint8(at, n & 0xff);
      view.setUint8(at + 1, (n >> 8) & 0xff);
      view.setUint8(at + 2, (n >> 16) & 0xff);
    }
  });
  return bytes;
}

const mono = [0, 0.5, -0.5, 0.25, -1];

describe("readWav", () => {
  it.each(["pcm16", "pcm24", "float32"] as const)(
    "reads %s mono",
    (encoding) => {
      const { samples, sampleRate } = readWav(
        buildWav(encoding, 1, 48000, mono),
      );
      expect(sampleRate).toBe(48000);
      expect(samples).toBeInstanceOf(Float32Array);
      expect(samples.length).toBe(mono.length);
      mono.forEach((v, i) => expect(samples[i]).toBeCloseTo(v, 5));
    },
  );

  it.each(["pcm16", "pcm24", "float32"] as const)(
    "mixes %s stereo to mono",
    (encoding) => {
      const { samples, sampleRate } = readWav(
        buildWav(encoding, 2, 44100, [0.5, -0.5, 0.75, 0.25, -0.25, -0.25]),
      );
      expect(sampleRate).toBe(44100);
      [0, 0.5, -0.25].forEach((v, i) => expect(samples[i]).toBeCloseTo(v, 5));
    },
  );

  it("skips unknown chunks before data", () => {
    const base = buildWav("pcm16", 1, 8000, [0.5]);
    const extra = new Uint8Array([76, 73, 83, 84, 3, 0, 0, 0, 1, 2, 3, 0]); // "LIST", odd size + pad
    const bytes = new Uint8Array(base.length + extra.length);
    bytes.set(base.subarray(0, 36), 0);
    bytes.set(extra, 36);
    bytes.set(base.subarray(36), 36 + extra.length);
    expect(readWav(bytes).samples[0]).toBeCloseTo(0.5, 5);
  });

  it("rejects non-WAV input and unsupported formats", () => {
    expect(() => readWav(new Uint8Array(20))).toThrow(/RIFF/);
    const eight = buildWav("pcm16", 1, 8000, [0]);
    new DataView(eight.buffer).setUint16(34, 8, true);
    expect(() => readWav(eight)).toThrow(/Unsupported/);
  });
});
