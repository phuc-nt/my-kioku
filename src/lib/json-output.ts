// Unified JSON envelope for all CLI output so agents can parse responses stably.
// Success: {ok: true, data}; failure: {ok: false, error, hint?}.

export interface OkEnvelope<T> {
  ok: true;
  data: T;
}

export interface FailEnvelope {
  ok: false;
  error: string;
  hint?: string;
}

export type Envelope<T> = OkEnvelope<T> | FailEnvelope;

/** Print a success envelope to stdout and exit 0. */
export function ok<T>(data: T): never {
  process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
  process.exit(0);
}

/** Print a failure envelope to stdout and exit 1. */
export function fail(error: string, hint?: string): never {
  const payload: FailEnvelope = { ok: false, error };
  if (hint) payload.hint = hint;
  process.stdout.write(JSON.stringify(payload) + "\n");
  process.exit(1);
}

