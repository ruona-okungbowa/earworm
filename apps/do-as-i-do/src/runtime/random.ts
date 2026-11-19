import type { RandomSource } from "../logic/index.js";

/** The only Math.random call in the App. */
export const systemRandom: RandomSource = () => Math.random();
