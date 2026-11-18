/**
 * URL of the bundled Worklet module. The import is dynamic so importing
 * `@earworm/browser` in Node never evaluates the `?worker&url` import.
 */
export async function getWorkletUrl(): Promise<string> {
  return (await import("./worklet-url.js")).default;
}
