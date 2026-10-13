// The one-time import of a repository's own `.docket/` folder onto the machine-local layout. The
// adapter is the only code that ever opens a repo-side `.docket/`, and it only reads there.
import type { DefinitionIssue, Result } from '../../domain/index';

export interface LegacyImportReport {
  readonly warnings: readonly string[];
  readonly renames: readonly { readonly id: string; readonly to: string }[];
}

export interface LegacyImporter {
  /** Reads `<path>/.docket/` and writes the mapped definitions under the global root; nothing in
   *  the repository is modified. An invalid legacy folder writes nothing and answers every issue. */
  importLegacyRepo(path: string): Promise<Result<LegacyImportReport, readonly DefinitionIssue[]>>;
}
