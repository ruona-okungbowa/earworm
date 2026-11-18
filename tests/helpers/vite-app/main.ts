import {
  createAudioEngine,
  createCapturePipeline,
  getWorkletUrl,
} from "@earworm/browser";

// Build fixture for tests/core/packaging/vite-build.test.ts. Never run in a browser.
void getWorkletUrl().then((url) => {
  console.log(url);
});
const pipeline = createCapturePipeline(createAudioEngine());
void pipeline.start().then(() => pipeline.stop());
