// Single source for the app version — read from package.json (resolveJsonModule is on).
// Kept out of labels.ts so the literal lives in one place.
import pkg from '../../../package.json';

export const VERSION: string = pkg.version ?? '0.0.0';
