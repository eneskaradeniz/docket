// The github connector's manifest — the module's whole description: what it provides, which
// hosts select it, which hosts it may reach, and that it shells out to the gh CLI. Authentication
// stays inside the CLI's own keyring session, so there is no account field to declare.
import { CONNECTOR_API_VERSION, parseSlug, type ConnectorManifest } from '../../../domain/index';

// The id is a constant; a non-slug here is a programming error, not a runtime case.
const id = parseSlug<'connector'>('github');
if (!id.ok) throw new Error('github connector id must be a slug');

export const githubManifest: ConnectorManifest = {
  id: id.value,
  name: 'GitHub',
  version: '1.0.0',
  apiVersion: CONNECTOR_API_VERSION,
  provides: ['forge', 'tracker'],
  hostMatch: ['github.com'],
  network: ['api.github.com', 'github.com'],
  settings: [],
  requiresCli: 'gh',
};
