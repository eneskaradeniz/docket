// The connector context (the connector addendum): the only capabilities a connector module
// receives. Everything a connector can do — reach the network, hold a secret, run its declared
// CLI, read time, mint an id, leave a diagnostic line — arrives through this one object, so the
// boundary doubles as the future process seam: a connector that lives behind it needs no other
// path to the machine to run elsewhere later.
import type { Result } from '../../domain/index';

import type { Clock } from './clock';
import type { IdGen } from './id-gen';
import type { CommandRunner } from './repo-tools';

/** One outbound request. The manifest's `network` allowlist is the only gate in front of it. */
export interface HttpRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs?: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

/** `egress_denied` is the allowlist's refusal: the request never left the machine. */
export type HttpError = 'egress_denied' | 'network' | 'timeout';

export interface HttpPort {
  request(req: HttpRequest): Promise<Result<HttpResponse, HttpError>>;
}

/** Resolves a keychain ref held by one of the connector's own accounts. A ref outside them
 *  answers undefined — one connector never reads another's secret. */
export interface ConnectorSecrets {
  resolve(ref: string): Promise<string | undefined>;
}

/** A diagnostic line. The implementation redacts, so a secret value resolved through the
 *  context never crosses back out here. */
export interface ConnectorLog {
  line(message: string): void;
}

/** What a readiness probe answers: usable, or the one thing missing. */
export type ConnectorReadiness = 'ready' | 'needs_cli' | 'needs_account';

export interface ConnectorContext {
  readonly http: HttpPort;
  readonly secrets: ConnectorSecrets;
  /** The exec port. At run time it refuses everything but the declared CLI's own commands (and
   *  `git push`, the one host-side git member the forge family needs); a manifest without
   *  `requiresCli` declares no command capability, so every command is refused. */
  readonly commands: CommandRunner;
  readonly clock: Clock;
  readonly ids: IdGen;
  readonly log: ConnectorLog;
}
