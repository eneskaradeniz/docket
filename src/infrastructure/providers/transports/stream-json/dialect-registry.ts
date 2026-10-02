// The built-in stream dialects, keyed by the `streamDialect` id of the provider definition.
// Each dialect lands in its own issue and registers itself here. An id without an entry
// surfaces as an `unsupported` report from the transport factory, never as a crash.
import { createSystemClock } from '../../../system/index';
import { createAgyDialect } from './dialects/agy/index';
import { createAmpDialect } from './dialects/amp/index';
import { createCodebuddyDialect } from './dialects/codebuddy/index';
import type { StreamDialect } from './stream-json';

export const BUILTIN_STREAM_DIALECTS: Readonly<Record<string, StreamDialect>> = {
  agy: createAgyDialect(createSystemClock()),
  amp: createAmpDialect(createSystemClock()),
  codebuddy: createCodebuddyDialect(createSystemClock()),
};
