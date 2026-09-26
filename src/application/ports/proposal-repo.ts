// Persistence port for definition-change proposals.
import type { Proposal, ProposalId, ProposalStatus } from '../../domain/index';
import type { DefinitionScope } from './definition-store';

export interface ProposalRecord extends Proposal {
  readonly scope: DefinitionScope;
}

export interface ProposalRepo {
  save(record: ProposalRecord): Promise<void>; // upsert
  get(id: ProposalId): Promise<ProposalRecord | undefined>;
  list(filter: { readonly status?: ProposalStatus }): Promise<readonly ProposalRecord[]>;
}
