// Definition store over YAML files: global root merged with per-workspace overrides.
import type { DefinitionStore } from '../../../application/index';
import type { WorkspacePaths } from '../../system/index';

export interface YamlStoreConfig {
  readonly globalRoot: string;
  readonly workspaces: WorkspacePaths;
}

export function createYamlDefinitionStore(config: YamlStoreConfig): DefinitionStore {
  void config;
  throw new Error('not implemented');
}
