// In-memory LegacyImporter — records the paths it was asked to import and answers a scripted result.
import type { DefinitionIssue, Result } from '../../../domain/index';
import { ok } from '../../../domain/index';
import type { LegacyImporter, LegacyImportReport } from '../legacy-importer';

export interface FakeLegacyImporter extends LegacyImporter {
  /** Scripts the answer of every following import. */
  setResult(result: Result<LegacyImportReport, readonly DefinitionIssue[]>): void;
  /** Paths imported, in call order. */
  imported(): readonly string[];
}

export const createFakeLegacyImporter = (): FakeLegacyImporter => {
  let result: Result<LegacyImportReport, readonly DefinitionIssue[]> = ok({ warnings: [], renames: [] });
  const imported: string[] = [];
  return {
    setResult: (next): void => {
      result = next;
    },
    imported: (): readonly string[] => imported,
    importLegacyRepo: async (path: string) => {
      imported.push(path);
      return result;
    },
  };
};
