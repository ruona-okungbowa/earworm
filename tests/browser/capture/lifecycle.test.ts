import { createAudioEngine, createCapturePipeline } from "@earworm/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stubs getUserMedia and AudioContext.resume. The engine wraps an OfflineAudioContext
// (a real AudioContext in headless Chromium is held by the autoplay policy), patched
// with createMediaStreamSource so the pipeline can run against a fake stream.

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  readyState: "live" | "ended";
}

function fakeStream(): { stream: MediaStream; tracks: FakeTrack[] } {
  const tracks: FakeTrack[] = [{ stop: vi.fn(), readyState: "live" }];
  for (const t of tracks) {
    t.stop.mockImplementation(() => {
      t.readyState = "ended";
    });
  }
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  return { stream, tracks };
}

function domError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

interface Rig {
  ctx: OfflineAudioContext;
  resume: ReturnType<typeof vi.fn>;
  getUserMedia: ReturnType<typeof vi.spyOn>;
  tracks: FakeTrack[];
  nodes: AudioWorkletNode[];
}

let rig: Rig;
const RealWorkletNode = globalThis.AudioWorkletNode;

beforeEach(() => {
  const ctx = new OfflineAudioContext(1, 48_000, 48_000);
  const resume = vi.fn(() => Promise.resolve());
  Object.defineProperty(ctx, "resume", { value: resume });
  Object.defineProperty(ctx, "createMediaStreamSource", {
    value: () => ctx.createGain(),
  });

  const tracks: FakeTrack[] = [];
  const getUserMedia = vi
    .spyOn(navigator.mediaDevices, "getUserMedia")
    .mockImplementation(() => {
      const s = fakeStream();
      tracks.push(...s.tracks);
      return Promise.resolve(s.stream);
    });

  const nodes: AudioWorkletNode[] = [];
  class SpyNode extends RealWorkletNode {
    constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
      super(...args);
      nodes.push(this);
    }
  }
  vi.stubGlobal("AudioWorkletNode", SpyNode);

  rig = { ctx, resume, getUserMedia, tracks, nodes };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const make = () => createCapturePipeline(createAudioEngine(rig.ctx));

describe("Capture_Pipeline lifecycle", () => {
  it("requests audio with echoCancellation, noiseSuppression and autoGainControl off", async () => {
    const p = make();
    await p.start();
    expect(rig.getUserMedia).toHaveBeenCalledTimes(1);
    expect(rig.getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    expect(p.state).toBe("running");
    await p.stop();
  });

  it("resumes a suspended context", async () => {
    const p = make();
    await p.start();
    expect(rig.resume).toHaveBeenCalledTimes(1);
    await p.stop();
  });

  it.each([
    ["NotAllowedError", "permission-denied"],
    ["NotFoundError", "no-device"],
    ["OverconstrainedError", "no-device"],
  ])("%s rejects with %s and stays restartable", async (name, code) => {
    rig.getUserMedia.mockRejectedValueOnce(domError(name));
    const p = make();
    await expect(p.start()).rejects.toMatchObject({ code });
    expect(p.state).toBe("stopped");
    expect(rig.tracks.filter((t) => t.readyState === "live")).toHaveLength(0);
    expect(rig.nodes).toHaveLength(0);

    await p.start();
    expect(p.state).toBe("running");
    await p.stop();
  });

  it("resume failure rejects with audio-context-resume and releases the stream", async () => {
    rig.resume.mockRejectedValueOnce(domError("InvalidStateError"));
    const p = make();
    await expect(p.start()).rejects.toMatchObject({
      code: "audio-context-resume",
    });
    expect(p.state).toBe("stopped");
    expect(rig.tracks).toHaveLength(1);
    expect(rig.tracks.every((t) => t.readyState === "ended")).toBe(true);

    await p.start();
    expect(p.state).toBe("running");
    await p.stop();
  });

  it("a second start opens no second stream", async () => {
    const p = make();
    const a = p.start();
    const b = p.start();
    await Promise.all([a, b]);
    await p.start();
    expect(rig.getUserMedia).toHaveBeenCalledTimes(1);
    expect(rig.nodes).toHaveLength(1);
    await p.stop();
  });

  it("stop stops tracks and closes the Worklet", async () => {
    const p = make();
    await p.start();
    const node = rig.nodes[0]!;
    const disconnect = vi.spyOn(node, "disconnect");
    const closePort = vi.spyOn(node.port, "close");

    await p.stop();

    expect(p.state).toBe("stopped");
    expect(rig.tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(rig.tracks.every((t) => t.readyState === "ended")).toBe(true);
    expect(disconnect).toHaveBeenCalled();
    expect(closePort).toHaveBeenCalled();
    expect(node.port.onmessage).toBeNull();
  });

  it("can start again after stop with a fresh stream", async () => {
    const p = make();
    await p.start();
    await p.stop();
    await p.start();
    expect(rig.getUserMedia).toHaveBeenCalledTimes(2);
    expect(p.state).toBe("running");
    await p.stop();
  });
});
