// Read-only scan of provider user-level capability config (P-60). The adapter lives in
// infrastructure; this port is the application boundary.
import type { CapabilityDef, MachineCandidate, Result } from '../../domain/index';

export type MachineCapabilityMaterializeError =
  | 'missing_command'
  | 'missing_path'
  | 'missing_plugin_source'
  | 'missing_secret_ref'
  | 'unreadable';

export interface MachineCapabilityScan {
  scan(providers: readonly string[]): Promise<readonly MachineCandidate[]>;
  buildDefinition(
    candidate: MachineCandidate,
    id: string,
    secretRefs: Readonly<Record<string, string>>,
  ): Promise<Result<CapabilityDef, MachineCapabilityMaterializeError>>;
}
