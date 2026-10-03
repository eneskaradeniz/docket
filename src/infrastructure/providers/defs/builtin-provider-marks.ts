// The built-in defs' marks as the api's marks source answers them: def id → the def's own mark.
// The composition root hands this to createApi; adding a provider changes only its def.
import type { ProviderMarks } from '../../../application/index';
import { BUILTIN_PROVIDER_DEFS } from './builtin-provider-defs';

export const builtinProviderMarks: ProviderMarks = {
  marks: () => Object.fromEntries(BUILTIN_PROVIDER_DEFS.map((def) => [def.id, def.mark])),
};
