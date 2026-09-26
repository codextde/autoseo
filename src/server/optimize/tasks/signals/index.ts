import "server-only";
// Importing this module registers the built-in task signal providers.
import "./setup";
import "./visibility";
import "./citations";
import "./reputation";
import "./competitor";
import "./content";
import "./technical";
import "./search-console";

export { registerTaskSignal, getTaskSignals, getTaskSignal } from "./registry";
export type { TaskSignalProvider, TaskFinding, SignalContext, SignalOutcome } from "./types";
