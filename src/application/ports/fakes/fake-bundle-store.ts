// fakes/fake-bundle-store.ts — in-memory implementation of BundleStore for tests (I-100).
import type { ProjectSlug, Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';
import type { BundleStore, DocketBundle } from '../bundle-store';

export interface FakeBundleStore extends BundleStore {
  readonly exported: readonly { readonly project: ProjectSlug; readonly bundle: DocketBundle; readonly path: string }[];
  seed(path: string, bundle: DocketBundle): void;
  seedRaw(path: string, content: string): void;
  setFailIo(fail: boolean): void;
}

export function createFakeBundleStore(root = '/fake/docket/exports'): FakeBundleStore {
  const bundles = new Map<string, DocketBundle>();
  const rawContents = new Map<string, string>();
  const exportedList: { project: ProjectSlug; bundle: DocketBundle; path: string }[] = [];
  let failIo = false;

  return {
    get exported() {
      return [...exportedList];
    },

    setFailIo(fail: boolean) {
      failIo = fail;
    },

    seed(path: string, bundle: DocketBundle) {
      bundles.set(path, bundle);
    },

    seedRaw(path: string, content: string) {
      rawContents.set(path, content);
    },

    async export(project: ProjectSlug, bundle: DocketBundle): Promise<Result<{ readonly path: string }, 'io_failed'>> {
      if (failIo) return err('io_failed');

      const baseName = `${project}-${bundle.createdAt}`;
      let candidate = `${root}/${baseName}.docket-bundle.json`;
      let collisionIndex = 2;

      while (bundles.has(candidate) || rawContents.has(candidate)) {
        candidate = `${root}/${baseName}-${collisionIndex}.docket-bundle.json`;
        collisionIndex++;
      }

      const finalBundle: DocketBundle = {
        ...bundle,
        checksum: bundle.checksum || 'sha256-placeholder',
      };

      bundles.set(candidate, finalBundle);
      exportedList.push({ project, bundle: finalBundle, path: candidate });
      return ok({ path: candidate });
    },

    async read(path: string): Promise<Result<DocketBundle, 'not_found' | 'wrong_format' | 'bad_checksum'>> {
      if (rawContents.has(path)) {
        const raw = rawContents.get(path)!;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return err('wrong_format');
        }
        if (typeof parsed !== 'object' || parsed === null) return err('wrong_format');
        const b = parsed as Record<string, unknown>;
        if (b.format !== 'docket-bundle' || b.version !== 1) return err('wrong_format');
        if (typeof b.checksum !== 'string') return err('wrong_format');
        if (raw.includes('__BAD_CHECKSUM__') || b.checksum.includes('corrupt')) {
          return err('bad_checksum');
        }
        return ok(parsed as DocketBundle);
      }

      const stored = bundles.get(path);
      if (stored === undefined) return err('not_found');
      if (stored.format !== 'docket-bundle' || stored.version !== 1) return err('wrong_format');
      return ok(stored);
    },
  };
}
