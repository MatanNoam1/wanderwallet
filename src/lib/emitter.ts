import { EventEmitter } from "events";

// One emitter per process. Worker emits "expense:<tripId>" when a job settles;
// SSE route listens and pushes to the client.
const globalForEmitter = globalThis as unknown as { tripEmitter?: EventEmitter };

export const tripEmitter =
  globalForEmitter.tripEmitter ?? new EventEmitter().setMaxListeners(100);

if (process.env.NODE_ENV !== "production")
  globalForEmitter.tripEmitter = tripEmitter;
