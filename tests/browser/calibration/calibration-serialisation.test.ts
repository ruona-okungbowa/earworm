import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseCalibration, serialiseCalibration } from "@earworm/browser";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 20: Calibration serialisation
// **Validates: Requirements 6.7, 6.8, 6.9**

const validArb = fc.record({
  noiseFloorDb: fc.double({ min: -120, max: 0, noNaN: true }),
  latencyMs: fc.double({ min: 0, max: 500, noNaN: true }),
});

function code(text: string): string | undefined {
  const r = parseCalibration(text);
  return r.ok ? undefined : r.error.code;
}

describe("Property 20: Calibration serialisation", () => {
  it("round trips every valid Calibration", () => {
    fc.assert(
      fc.property(validArb, (c) => {
        const r = parseCalibration(serialiseCalibration(c));
        expect(r.ok).toBe(true);
        // JSON has no -0, so compare numerically (-0 === 0).
        if (r.ok) {
          expect(r.value.noiseFloorDb === c.noiseFloorDb).toBe(true);
          expect(r.value.latencyMs === c.latencyMs).toBe(true);
        }
      }),
      pbtParams(),
    );
  });

  it("accepts the range endpoints", () => {
    for (const c of [
      { noiseFloorDb: -120, latencyMs: 0 },
      { noiseFloorDb: 0, latencyMs: 500 },
    ]) {
      const r = parseCalibration(serialiseCalibration(c));
      expect(r.ok && r.value).toEqual(c);
    }
  });

  it("rejects out-of-range values", () => {
    const badNoise = fc.oneof(
      fc.double({ min: 1e-9, max: 1e6, noNaN: true }),
      fc.double({ min: -1e6, max: -120.000001, noNaN: true }),
    );
    const badLatency = fc.oneof(
      fc.double({ min: 500.000001, max: 1e6, noNaN: true }),
      fc.double({ min: -1e6, max: -1e-9, noNaN: true }),
    );
    fc.assert(
      fc.property(
        validArb,
        badNoise,
        badLatency,
        fc.constantFrom("noise", "latency", "both"),
        (v, n, l, which) => {
          const c = {
            noiseFloorDb: which === "latency" ? v.noiseFloorDb : n,
            latencyMs: which === "noise" ? v.latencyMs : l,
          };
          expect(code(JSON.stringify(c))).toBe("invalid-calibration");
        },
      ),
      pbtParams(),
    );
  });

  it("rejects text that is not JSON", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => {
          try {
            JSON.parse(s);
            return false;
          } catch {
            return true;
          }
        }),
        (s) => {
          expect(code(s)).toBe("invalid-calibration");
        },
      ),
      pbtParams(),
    );
  });

  it("rejects JSON of the wrong shape or with non-numeric fields", () => {
    const nonNumber = fc.oneof(
      fc.string(),
      fc.boolean(),
      fc.constant(null),
      fc.array(fc.integer(), { maxLength: 3 }),
    );
    fc.assert(
      fc.property(
        validArb,
        nonNumber,
        fc.constantFrom("noiseFloorDb", "latencyMs"),
        (v, junk, field) => {
          expect(code(JSON.stringify({ ...v, [field]: junk }))).toBe(
            "invalid-calibration",
          );
          const { [field as "noiseFloorDb"]: _omitted, ...missing } = v;
          expect(code(JSON.stringify(missing))).toBe("invalid-calibration");
        },
      ),
      pbtParams(),
    );
    for (const text of ["null", "[]", "42", '"x"', "true", "{}", ""]) {
      expect(code(text)).toBe("invalid-calibration");
    }
  });
});
