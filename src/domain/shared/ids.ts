import { err, ok, type Result } from './result';

declare const brand: unique symbol;
export type Branded<T, B extends string> = T & { readonly [brand]: B };

/** User-authored identifiers inside definitions: ^[a-z0-9][a-z0-9-]{0,62}$ */
export type Slug<B extends string> = Branded<string, B>;
export type RoleSlug = Slug<'role'>;
export type FlowSlug = Slug<'flow'>;
export type StageSlug = Slug<'stage'>;
export type GateSlug = Slug<'gate'>;
export type CapabilitySlug = Slug<'capability'>;
export type WorkspaceSlug = Slug<'workspace'>;
export type PhaseSlug = Slug<'phase'>;
export type TaskSlug = Slug<'task'>;

/** Runtime identifiers: ULID, 26 chars Crockford base32 (0-9 A-H J K M N P-T V-Z), uppercase. */
export type Ulid<B extends string> = Branded<string, B>;
export type WorkOrderId = Ulid<'work-order'>;
export type RunId = Ulid<'run'>;
export type AccountId = Ulid<'account'>;
export type PoolId = Ulid<'pool'>;
export type MeterId = Ulid<'meter'>;
export type ProposalId = Ulid<'proposal'>;
export type PageId = Ulid<'page'>;
export type QueueItemId = Ulid<'queue-item'>;

export type IdError = { readonly code: 'invalid_slug' | 'invalid_ulid'; readonly input: string };

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
// Crockford base32 without I, L, O, U.
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function parseSlug<B extends string>(input: string): Result<Slug<B>, IdError> {
  return SLUG_PATTERN.test(input) ? ok(input as Slug<B>) : err({ code: 'invalid_slug', input });
}

export function parseUlid<B extends string>(input: string): Result<Ulid<B>, IdError> {
  return ULID_PATTERN.test(input) ? ok(input as Ulid<B>) : err({ code: 'invalid_ulid', input });
}

export function isSlug(input: string): boolean {
  return SLUG_PATTERN.test(input);
}

export function isUlid(input: string): boolean {
  return ULID_PATTERN.test(input);
}
