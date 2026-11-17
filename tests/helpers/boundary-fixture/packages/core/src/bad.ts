// Deliberate violation: core must not import browser.
import { stub } from "../../browser/src/index.ts";

export const bad = stub;
