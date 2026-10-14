// definition-versions UI tests (U-292, U-293, R-132).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DetailRunCard } from './detail-run-card';
import { PastVersionsModal } from './past-versions-modal';
import { RemovalActionButton } from './removal-action-button';
import { VersionBadge } from './version-badge';
import type { RepoSlug, StageSlug } from '../../domain/index';
import { removalBlockNote } from '../stores/roles';

describe('definition versions UI', () => {
  it('U-292: every definition row displays current version badge; Eski sürümler opens read-only past versions modal', () => {
    const badge = renderToStaticMarkup(createElement(VersionBadge, { locale: 'tr', version: 3 }));
    expect(badge).toContain('v3');
    expect(badge).toContain('role="status"');
    const modal = renderToStaticMarkup(
      createElement(PastVersionsModal, {
        open: true,
        locale: 'tr',
        roleName: 'Uygulayıcı',
        currentVersion: 3,
        versions: [
          { version: 2, recordedAt: 1, archived: false },
          { version: 1, recordedAt: 0, archived: false },
        ],
        onClose: () => undefined,
      }),
    );
    expect(modal).toContain('data-past-versions-dialog');
    expect(modal).toContain('v2');
    expect(modal).toContain('v1');
    const empty = renderToStaticMarkup(
      createElement(PastVersionsModal, {
        open: true,
        locale: 'tr',
        roleName: 'Yeni',
        currentVersion: 1,
        versions: [{ version: 1, recordedAt: 0, archived: false }],
        onClose: () => undefined,
      }),
    );
    expect(empty).toContain('Eski sürüm bulunmuyor.');
  });

  it('U-293: referenced definition replaces Sil with Arşivle', () => {
    const archive = renderToStaticMarkup(
      createElement(RemovalActionButton, {
        locale: 'tr',
        action: 'archive',
        labelAction: 'archive',
        blockNote: null,
        onAction: () => undefined,
      }),
    );
    expect(archive).toContain('Arşivle');
    const deleteReady = renderToStaticMarkup(
      createElement(RemovalActionButton, {
        locale: 'tr',
        action: 'delete',
        labelAction: 'delete',
        blockNote: null,
        onAction: () => undefined,
      }),
    );
    expect(deleteReady).toContain('Sil');
    expect(deleteReady).not.toContain('disabled=""');
  });

  it('U-293: Sil and Arşivle disabled when running work or dependants exist, displaying blocking dependants', () => {
    const note = removalBlockNote(
      'tr',
      {
        kind: 'blocked',
        reasons: [
          { kind: 'dependant', of: 'stage', repo: 'api' as RepoSlug, stage: 'app' as StageSlug },
          { kind: 'dependant', of: 'stage', repo: 'api' as RepoSlug, stage: 'fix' as StageSlug },
        ],
      },
      [
        {
          flow: 'api',
          flowName: 'api',
          stage: 'app',
          stageName: 'Uygulama',
          tier: null,
          thinking: null,
          reviewOf: null,
          sameProviderReview: false,
        },
        {
          flow: 'api',
          flowName: 'api',
          stage: 'fix',
          stageName: 'Düzeltme',
          tier: null,
          thinking: null,
          reviewOf: null,
          sameProviderReview: false,
        },
      ],
    );
    expect(note?.short).toContain('2 aşamada');
    expect(note?.short).toContain('api (Uygulama)');
    const blocked = renderToStaticMarkup(
      createElement(RemovalActionButton, {
        locale: 'tr',
        action: 'blocked',
        labelAction: 'delete',
        blockNote: note,
        onAction: () => undefined,
      }),
    );
    expect(blocked).toContain('disabled');
    expect(blocked).toContain('role="note"');
  });

  it('R-132: past run card displays pinned flowVersion and roleVersion', () => {
    const html = renderToStaticMarkup(
      createElement(DetailRunCard, {
        locale: 'tr',
        run: {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
          shortCode: 'run_5fa0',
          stage: 'build',
          attempt: 1,
          startedAt: 1_000,
          endedAt: 2_000,
          outcome: 'succeeded',
          accountLabel: 'a1',
          model: 'm1',
          billing: 'included',
          cost: null,
          usage: null,
          flowVersion: 2,
          roleVersion: 1,
        },
      }),
    );
    expect(html).toContain('Akış: v2');
    expect(html).toContain('Rol: v1');
    expect(html).toContain('Sabitlenen sürümler');
  });
});
