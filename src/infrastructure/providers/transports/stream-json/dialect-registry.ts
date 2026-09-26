// The built-in stream dialects, keyed by the `streamDialect` id of the provider definition.
// The set is deliberately empty for now: the first real dialect lands in its own issue and
// registers itself here. An id without an entry surfaces as an `unsupported` report from the
// transport factory, never as a crash.
import type { StreamDialect } from './stream-json';

export const BUILTIN_STREAM_DIALECTS: Readonly<Record<string, StreamDialect>> = {};
