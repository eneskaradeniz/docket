// mcp/ask-script-path.ts — where the built agy permission-ask child sits (I-108). The per-run
// PreToolUse launcher the agy delivery writes execs this script as plain Node (the docket-mcp.cjs
// precedent), so the file name here is the one spelling the delivery's launcher and the build
// entry agree on; the delivery cannot import this module (the providers module depends on system
// only), so its tests pin the two spellings against ASK_SCRIPT_NAME.
import { resolve } from 'node:path';

export const ASK_SCRIPT_NAME = 'docket-agy-ask.cjs';

/** The built ask child, next to the main bundle (`dist-electron/` in dev and in the package). */
export const askScriptPath = (mainDir: string): string => resolve(mainDir, ASK_SCRIPT_NAME);
