// storage/bundle/store.ts — createFsBundleStore implementing BundleStore (I-100, I-89, I-98, I-99).
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { ProjectSlug, Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';
import type { BundleStore, DocketBundle } from '../../../application/ports/bundle-store';
import { canonicalize, computeBundleChecksum } from './canonical-json';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatUtcTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  const seconds = pad(d.getUTCSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function createFsBundleStore(root: string): BundleStore {
  return {
    async export(
      project: ProjectSlug,
      bundle: DocketBundle,
    ): Promise<Result<{ readonly path: string }, 'io_failed'>> {
      try {
        await mkdir(root, { recursive: true });

        const ts = formatUtcTimestamp(bundle.createdAt);
        const baseName = `${project}-${ts}`;
        let candidate = join(root, `${baseName}.docket-bundle.json`);
        let collisionIndex = 2;

        while (await fileExists(candidate)) {
          candidate = join(root, `${baseName}-${collisionIndex}.docket-bundle.json`);
          collisionIndex++;
        }

        const checksum = computeBundleChecksum(bundle as unknown as Record<string, unknown>);
        const bundleWithChecksum: DocketBundle = {
          ...bundle,
          checksum,
        };

        const serialized = canonicalize(bundleWithChecksum);

        // Stage file in temporary directory and rename into place (I-100)
        const tempDir = await mkdtemp(join(tmpdir(), 'docket-bundle-'));
        const tempFile = join(tempDir, 'export.json');
        try {
          await writeFile(tempFile, serialized, 'utf8');
          await rename(tempFile, candidate);
        } finally {
          await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }

        return ok({ path: resolve(candidate) });
      } catch {
        return err('io_failed');
      }
    },

    async read(
      path: string,
    ): Promise<Result<DocketBundle, 'not_found' | 'wrong_format' | 'bad_checksum'>> {
      let content: string;
      try {
        content = await readFile(path, 'utf8');
      } catch (error) {
        return err('not_found');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        return err('wrong_format');
      }

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return err('wrong_format');
      }

      const record = parsed as Record<string, unknown>;
      if (record.format !== 'docket-bundle' || record.version !== 1) {
        return err('wrong_format');
      }
      if (typeof record.checksum !== 'string') {
        return err('wrong_format');
      }

      // Recomputed checksum against RFC 8785 canonical form (I-98)
      const expectedChecksum = computeBundleChecksum(record);
      if (record.checksum !== expectedChecksum) {
        return err('bad_checksum');
      }

      // Validate required envelope fields
      if (
        !Number.isFinite(record.createdAt) ||
        !Array.isArray(record.projects) ||
        !Array.isArray(record.repos) ||
        record.library === undefined ||
        record.memory === undefined
      ) {
        return err('wrong_format');
      }

      return ok(parsed as DocketBundle);
    },
  };
}
