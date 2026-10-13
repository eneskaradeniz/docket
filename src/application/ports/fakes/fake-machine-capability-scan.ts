import type { CapabilityDef, MachineCandidate } from '../../../domain/index';
import { err, ok } from '../../../domain/index';
import type {
  MachineCapabilityMaterializeError,
  MachineCapabilityScan,
} from '../machine-capability-scan';

export interface FakeMachineCapabilityScan extends MachineCapabilityScan {
  seed(candidates: readonly MachineCandidate[]): void;
  seedDefinition(candidate: MachineCandidate, def: CapabilityDef): void;
}

export function createFakeMachineCapabilityScan(): FakeMachineCapabilityScan {
  let candidates: readonly MachineCandidate[] = [];
  const definitions = new Map<string, CapabilityDef>();

  const keyOf = (candidate: MachineCandidate): string =>
    `${candidate.provider}:${candidate.kind}:${candidate.name}:${candidate.sourcePath}`;

  return {
    seed(next) {
      candidates = next;
    },
    seedDefinition(candidate, def) {
      definitions.set(keyOf(candidate), def);
    },
    async scan() {
      return candidates;
    },
    async buildDefinition(candidate, id, secretRefs) {
      const def = definitions.get(keyOf(candidate));
      if (def === undefined) return err('unreadable' as MachineCapabilityMaterializeError);
      if (def.kind === 'mcp') {
        for (const name of candidate.secretNames) {
          if (secretRefs[name] === undefined) return err('missing_secret_ref');
        }
      }
      return ok({ ...def, id: id as CapabilityDef['id'] });
    },
  };
}
