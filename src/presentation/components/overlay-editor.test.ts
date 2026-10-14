// overlay-editor.test.ts — the re-link surface of the Roller section (U-298 … U-300, #1104):
// the row action on a detached binding, its confirm dialog, and the post-relink row. Static
// markup only; the modal shell's focus trap, Esc and focus return are the shared ModalWindow's.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RepoFlow, RoleDef, StageSlug, VersionRecord } from '../../domain/index';
import { parseSlug, roleUpdateProposals } from '../../domain/index';
import { OverlayEditor } from './overlay-editor';

const stage = (id: string): StageSlug => {
  const parsed = parseSlug<'stage'>(id);
  if (!parsed.ok) throw new Error(id);
  return parsed.value;
};
const role = (id: string) => {
  const parsed = parseSlug<'role'>(id);
  if (!parsed.ok) throw new Error(id);
  return parsed.value;
};
const capability = (id: string): RoleDef['capabilities'][number] => {
  const parsed = parseSlug<'capability'>(id);
  if (!parsed.ok) throw new Error(id);
  return parsed.value;
};

const WORKER: RoleDef = {
  id: role('worker'),
  name: 'Worker',
  instructions: 'Base instructions.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

/** v1 the base body, v2 new instructions, v3 also renamed — so v2 is an older choice and v3 latest. */
const library: readonly VersionRecord<RoleDef>[] = [
  { definitionId: WORKER.id, version: 1, body: WORKER, recordedAt: 0, archived: false },
  { definitionId: WORKER.id, version: 2, body: { ...WORKER, instructions: 'Upstream v2.' }, recordedAt: 1, archived: false },
  { definitionId: WORKER.id, version: 3, body: { ...WORKER, name: 'Engineer', instructions: 'Upstream v3.' }, recordedAt: 2, archived: false },
];

const flowSlug = (): RepoFlow['flowId'] => {
  const parsed = parseSlug<'flow'>('standard');
  if (!parsed.ok) throw new Error('flow slug');
  return parsed.value;
};

/** A repo-owned copy: the repo edited the instructions and the capabilities over v1. */
const detachedBody = (): RoleDef => ({
  ...WORKER,
  instructions: 'Local tweak.',
  capabilities: [capability('cap-a')],
});

const detachedFlow = (): RepoFlow => ({
  flowId: flowSlug(),
  version: 1,
  stages: [{ id: stage('implement'), name: 'Implement', role: WORKER.id, exit: [] }],
  bindings: [
    {
      stage: stage('implement'),
      role: { roleId: WORKER.id, version: 1, detached: detachedBody() },
      accounts: [],
    },
  ],
});

/** The same flow after "Bağla" with the overlay choice at v2 (v3 still ahead). */
const relinkedFlow = (): RepoFlow => ({
  flowId: flowSlug(),
  version: 1,
  stages: [{ id: stage('implement'), name: 'Implement', role: WORKER.id, exit: [] }],
  bindings: [
    {
      stage: stage('implement'),
      role: { roleId: WORKER.id, version: 2, overlay: { instructions: 'Local tweak.', capabilities: detachedBody().capabilities } },
      accounts: [],
    },
  ],
});

const noop = (): void => {};

const draw = (over: Partial<Parameters<typeof OverlayEditor>[0]>): string =>
  renderToStaticMarkup(
    createElement(OverlayEditor, {
      locale: 'tr',
      flow: detachedFlow(),
      stage: stage('implement'),
      library,
      proposals: [],
      proposalBlocked: [],
      onInstructions: noop,
      onDetach: noop,
      onApplyProposal: noop,
      onClearOverlayField: noop,
      relinkStage: null,
      relinkNotice: null,
      onRequestRelink: noop,
      onCancelRelink: noop,
      onConfirmRelink: noop,
      ...over,
    }),
  );

describe('U-298: re-link action on a detached binding', () => {
  it('U-298: a detached binding shows Kütüphaneye bağla in place of Ayır', () => {
    const html = draw({});
    expect(html).toContain('>Kütüphaneye bağla<');
    expect(html).not.toContain('>Ayır<');
    // The detached standing still reads on the badge.
    expect(html).toContain('>detached<');
  });

  it('U-298: the action is disabled with the visible reason when the library holds no version', () => {
    const html = draw({ library: [] });
    expect(html).toContain('disabled');
    expect(html).toContain('Rol kütüphanede yok');
  });
});

describe('U-299: re-link confirm dialog', () => {
  it('U-299: a modal dialog with a latest-default version select, the keep choice, the overlay field list, Vazgeç and Bağla', () => {
    const html = draw({ relinkStage: stage('implement') });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    // The version select defaults to the latest version (v3 of 3), older ones stay options.
    expect(html).toMatch(/<option[^>]*selected[^>]*>v3</);
    expect(html).toContain('>v1<');
    expect(html).toContain('>v2<');
    // The two choices, the local-changes one checked by default.
    expect(html).toContain('Yerel değişiklikleri tut');
    expect(html).toContain('Kütüphane sürümünü kullan');
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect((html.match(/checked/g) ?? []).length).toBeGreaterThanOrEqual(1);
    // The fields that become overlay are labels, never keys.
    expect(html).toContain('Yönerge');
    expect(html).toContain('Yetenekler');
    expect(html).not.toContain('>capabilities<');
    expect(html).not.toContain('>writeScope<');
    // Vazgeç is the default, focused answer; Bağla confirms.
    expect(html).toContain('autofocus');
    expect(html).toContain('>Vazgeç<');
    expect(html).toContain('>Bağla<');
  });
});

describe('U-300: the row after Bağla', () => {
  it('U-300: the badge shows the linked version, the update row appears, and the polite region announces', () => {
    const flow = relinkedFlow();
    const html = draw({
      flow,
      proposals: roleUpdateProposals(flow, library),
      relinkNotice: stage('implement'),
    });
    expect(html).toContain('>v2<');
    expect(html).toContain('Yeni sürüm var');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Rol kütüphaneye bağlandı');
    // The overlay survives: the editor still shows the local instructions.
    expect(html).toContain('Local tweak.');
  });

  it('U-300: the announcement is scoped to the stage that re-linked', () => {
    const flow = relinkedFlow();
    const html = draw({ flow, proposals: [], relinkNotice: stage('review') });
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('Rol kütüphaneye bağlandı');
  });
});
