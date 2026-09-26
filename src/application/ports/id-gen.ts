// Identifier port — ids come from here, never from randomness inside the application layer.
import type { Ulid } from '../../domain/index';

export interface IdGen {
  next<B extends string>(): Ulid<B>;
}
