/** Minimal WAV reader for test fixtures: 16-bit and 24-bit PCM, 32-bit float. Mixes to mono. */

export interface WavData {
  samples: Float32Array;
  sampleRate: number;
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

export function readWav(bytes: Uint8Array): WavData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || tag(view, 0) !== "RIFF" || tag(view, 8) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataStart = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.byteLength) throw new Error("Truncated fmt chunk");
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === FORMAT_EXTENSIBLE) {
        if (size < 26) throw new Error("Truncated extensible fmt chunk");
        format = view.getUint16(body + 24, true);
      }
    } else if (id === "data") {
      dataStart = body;
      dataLength = Math.min(size, bytes.byteLength - body);
      break;
    }
    offset = body + size + (size % 2);
  }

  if (channels === 0) throw new Error("Missing fmt chunk");
  if (dataStart < 0) throw new Error("Missing data chunk");

  const isFloat32 = format === FORMAT_FLOAT && bits === 32;
  const isPcm16 = format === FORMAT_PCM && bits === 16;
  const isPcm24 = format === FORMAT_PCM && bits === 24;
  if (!isFloat32 && !isPcm16 && !isPcm24) {
    throw new Error(`Unsupported WAV format ${format} with ${bits} bits`);
  }

  const bytesPerSample = bits / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * channels));
  const samples = new Float32Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = dataStart + (i * channels + c) * bytesPerSample;
      if (isPcm16) {
        sum += view.getInt16(at, true) / 32768;
      } else if (isPcm24) {
        const raw = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
        sum += ((raw << 8) >> 8) / 8388608;
      } else {
        sum += view.getFloat32(at, true);
      }
    }
    samples[i] = sum / channels;
  }

  return { samples, sampleRate };
}
