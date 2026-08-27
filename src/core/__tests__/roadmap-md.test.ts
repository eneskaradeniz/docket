// src/core/__tests__/roadmap-md.test.ts — the roadmap.md document contract, test-first (WO-0048,
// ADR-0016). The fixture mirrors the approved mockup's frame-01 facts (docs/ui-mockups/
// wo-0048-yol-haritasi.html): f0 done, f1 running with WO-0012 on fotoğraf, f2 blocked by f4.
// Written BEFORE src/core/roadmap-md.ts (ADR-0006: core is test-first).
import { describe, expect, it } from 'vitest';
import {
  applyFazlarEdits,
  buildRoadmapMd,
  DEFAULT_DOCS_ROOT,
  type FazSpec,
  normalizeDocsRoot,
  parseRoadmapMd,
  roadmapDiagnostics,
  nextFazId,
  nextTaskId,
} from '../roadmap-md';

// The canonical antreo fixture — mockup frame-01 EXACTLY. Object literals in the fence's canonical
// key order (id, title, aim?, blockedBy, notes?, tasks / id, title, repo?, note?) so the JSON below
// IS the serialized fence body.
const antreoFazlar: FazSpec[] = [
  {
    id: 'f0',
    title: 'Kullanıcı Yönetimi',
    aim: 'Rol ayrımı ve kimlik doğrulama',
    blockedBy: [],
    tasks: [
      { id: 'f0-t1', title: 'Rol ayrımı ve kayıt akışı', repo: 'api' },
      { id: 'f0-t2', title: 'Kimlik doğrulama yöntemleri', repo: 'api' },
    ],
  },
  {
    id: 'f1',
    title: 'Antrenör Profili',
    aim: 'Profil, doğrulama ve fotoğraf',
    blockedBy: [],
    tasks: [
      { id: 'f1-t1', title: 'Profil oluşturma', repo: 'api' },
      { id: 'f1-t2', title: 'Doğrulama akışı', repo: 'api' },
      { id: 'f1-t3', title: 'Fotoğraf yükleme', repo: 'mobile' },
      { id: 'f1-t4', title: 'Deneyim ve ücret alanları', repo: 'mobile' },
    ],
  },
  {
    id: 'f2',
    title: 'Değerlendirme',
    aim: 'Antrenör puanlama ve yorumlar',
    blockedBy: ['f4'],
    notes: 'Rezervasyon kavramı henüz kodlanmadı — Faz 4 tamamlanmadan başlanmayacak (gap analizi kararı)',
    tasks: [
      { id: 'f2-t1', title: 'Puanlama modeli', repo: 'api' },
      { id: 'f2-t2', title: 'Yorum akışı', repo: 'api' },
      { id: 'f2-t3', title: 'Yorum moderasyonu', repo: 'api' },
    ],
  },
  {
    id: 'f4',
    title: 'Rezervasyon',
    aim: 'Seans takvimi ve rezervasyon',
    blockedBy: ['f1'],
    tasks: [
      { id: 'f4-t1', title: 'Seans takvimi', repo: 'api' },
      { id: 'f4-t2', title: 'Rezervasyon oluşturma', repo: 'api' },
      { id: 'f4-t3', title: 'İptal koşulları', repo: 'mobile' },
    ],
  },
];

// A full canonical document around the fence — what buildRoadmapMd emits for the antreo fixture.
const antreoMd = `---
workspace: antreo-app
title: Antreo Yol Haritası
---

# Antreo Yol Haritası

Antrenör puanlama ve rezervasyon platformu — fazlar, görevler ve bağımlılıklar.

\`\`\`fazlar
${JSON.stringify(antreoFazlar, null, 2)}
\`\`\`
`;

// Wrap a fence body (or nothing) in a minimal document.
const doc = (fenceBody: string, front = '---\nworkspace: antreo-app\ntitle: T\n---\n\n'): string =>
  fenceBody === '' ? `${front}Prose only.` : `${front}\`\`\`fazlar\n${fenceBody}\n\`\`\`\n`;

const ctx = { workspaceSlug: 'antreo-app', knownRepos: ['api', 'mobile', 'docs'] };

describe('parseRoadmapMd — the ```fazlar fence contract (all-or-nothing)', () => {
  it('reads the antreo fixture: 4 fazlar, 12 tasks, verbatim Turkish, blockedBy as data', () => {
    const p = parseRoadmapMd(antreoMd);
    expect(p.parseError).toBeUndefined();
    expect(p.workspace).toBe('antreo-app');
    expect(p.title).toBe('Antreo Yol Haritası');
    expect(p.fazlar).toHaveLength(4);
    expect(p.fazlar.map((f) => f.id)).toEqual(['f0', 'f1', 'f2', 'f4']);
    expect(p.fazlar[2]!.blockedBy).toEqual(['f4']);
    expect(p.fazlar[2]!.notes).toContain('gap analizi kararı');
    expect(p.fazlar[1]!.tasks).toHaveLength(4);
    expect(p.fazlar[1]!.tasks[2]).toEqual({ id: 'f1-t3', title: 'Fotoğraf yükleme', repo: 'mobile' });
  });

  it('no fence → fazlar [] with reason no_fence (the invitation reason is never lost)', () => {
    const p = parseRoadmapMd(doc(''));
    expect(p.fazlar).toEqual([]);
    expect(p.parseError?.reason).toBe('no_fence');
  });

  it('non-JSON fence body → [] with reason bad_json and the parser message', () => {
    const p = parseRoadmapMd(doc('[{id: f0}]')); // unquoted key — invalid JSON
    expect(p.fazlar).toEqual([]);
    expect(p.parseError?.reason).toBe('bad_json');
    expect(p.parseError?.reason === 'bad_json' && p.parseError.message.length).toBeGreaterThan(0);
  });

  it('one malformed element collapses the whole list → [] with reason bad_element and the index', () => {
    const good = JSON.stringify([{ id: 'f0', title: 'A', blockedBy: [], tasks: [] }]);
    const badTitle = JSON.stringify([{ id: 'f0', title: 'A', blockedBy: [], tasks: [] }, { id: 'f1', blockedBy: [], tasks: [] }]);
    expect(parseRoadmapMd(doc(good)).fazlar).toHaveLength(1);
    const p = parseRoadmapMd(doc(badTitle));
    expect(p.fazlar).toEqual([]);
    expect(p.parseError?.reason).toBe('bad_element');
    expect(p.parseError?.reason === 'bad_element' && p.parseError.index).toBe(1);
  });

  it('bad shapes are named: blockedBy not an array, tasks not an array, task id not a string', () => {
    const cases: Array<[string, string]> = [
      [JSON.stringify([{ id: 'f0', title: 'A', blockedBy: 'f1', tasks: [] }]), 'blockedBy'],
      [JSON.stringify([{ id: 'f0', title: 'A', blockedBy: [], tasks: {} }]), 'tasks'],
      [JSON.stringify([{ id: 'f0', title: 'A', blockedBy: [], tasks: [{ id: 7, title: 'x' }] }]), 'task'],
    ];
    for (const [body, needle] of cases) {
      const p = parseRoadmapMd(doc(body));
      expect(p.fazlar).toEqual([]);
      expect(p.parseError?.reason).toBe('bad_element');
      expect(p.parseError?.reason === 'bad_element' && p.parseError.problem).toContain(needle);
    }
  });

  it('unknown extra keys are ignored (forward-compat, the parsePlanSteps reading)', () => {
    const p = parseRoadmapMd(doc(JSON.stringify([{ id: 'f0', title: 'A', blockedBy: [], tasks: [], weight: 3 }])));
    expect(p.parseError).toBeUndefined();
    expect(p.fazlar).toEqual([{ id: 'f0', title: 'A', blockedBy: [], tasks: [] }]);
  });

  it('empty-string optionals read as absent (repo "" is no repo)', () => {
    const p = parseRoadmapMd(doc(JSON.stringify([{ id: 'f0', title: 'A', aim: '', blockedBy: [], tasks: [{ id: 'f0-t1', title: 'x', repo: '' }] }])));
    expect(p.fazlar[0]!.aim).toBeUndefined();
    expect(p.fazlar[0]!.tasks[0]!.repo).toBeUndefined();
  });

  it('two fences → the LAST wins (a stray earlier draft cannot override)', () => {
    const first = JSON.stringify([{ id: 'f0', title: 'draft', blockedBy: [], tasks: [] }]);
    const p = parseRoadmapMd(`Prose.\n\n\`\`\`fazlar\n${first}\n\`\`\`\n\n${antreoMd}`);
    expect(p.fazlar).toHaveLength(4);
    expect(p.fazlar[0]!.title).toBe('Kullanıcı Yönetimi');
  });

  it('no front-matter → empty workspace/title, fence still parses', () => {
    const p = parseRoadmapMd('```fazlar\n[]\n```\n');
    expect(p.workspace).toBe('');
    expect(p.title).toBe('');
    expect(p.fazlar).toEqual([]);
  });
});

describe('applyFazlarEdits — surgical fence rewrite (the applyStepEdits precedent)', () => {
  it('rewrites ONLY the fence body: prefix and suffix preserved byte-for-byte', () => {
    const prefix = '---\nworkspace: w\ntitle: T\n---\n\nHand-edited prose ABOVE the fence.\n\n';
    const suffix = '\nA trailing note the operator wrote BELOW.\n';
    const md = `${prefix}\`\`\`fazlar\n[]\n\`\`\`${suffix}`;
    const compactBody = JSON.stringify([{ id: 'f0', title: 'A', blockedBy: [], tasks: [] }]);
    const out = applyFazlarEdits(md, parseRoadmapMd(doc(compactBody)).fazlar!);
    expect(out.startsWith(prefix)).toBe(true);
    expect(out.endsWith(suffix)).toBe(true);
    expect(out).toContain('"title": "A"');
  });

  it('canonical body is idempotent: apply(parse(md)) === md on a canonical document', () => {
    expect(applyFazlarEdits(antreoMd, parseRoadmapMd(antreoMd).fazlar)).toBe(antreoMd);
  });

  it('a hand-formatted (compact) fence is canonicalized ONCE, not per-edit', () => {
    const compact = doc(JSON.stringify(antreoFazlar));
    const once = applyFazlarEdits(compact, parseRoadmapMd(compact).fazlar);
    expect(once).toContain('\n  {\n    "id": "f0",');
    expect(applyFazlarEdits(once, parseRoadmapMd(once).fazlar)).toBe(once);
  });

  it('no fence → the text is returned UNCHANGED (the caller guards)', () => {
    const md = doc('');
    expect(applyFazlarEdits(md, antreoFazlar)).toBe(md);
  });
});

describe('buildRoadmapMd — the producer half', () => {
  it('emits front-matter (workspace, title), an H1, prose, and exactly one canonical fence', () => {
    const md = buildRoadmapMd({ workspaceSlug: 'antreo-app', title: 'Antreo Yol Haritası', prose: 'Satır.', fazlar: antreoFazlar });
    expect(md.startsWith('---\nworkspace: antreo-app\ntitle: Antreo Yol Haritası\n---\n')).toBe(true);
    expect(md).toContain('# Antreo Yol Haritası');
    expect(md).toContain('Satır.');
    expect(md.match(/```fazlar/g)).toHaveLength(1);
  });

  it('round-trips: parse(build(x)).fazlar deep-equals x.fazlar', () => {
    const md = buildRoadmapMd({ workspaceSlug: 'antreo-app', title: 'T', fazlar: antreoFazlar });
    expect(parseRoadmapMd(md).fazlar).toEqual(antreoFazlar);
  });

  it('pins the canonical key order (id, title, aim, blockedBy, notes, tasks)', () => {
    const md = buildRoadmapMd({ workspaceSlug: 'w', title: 'T', fazlar: antreoFazlar });
    expect(md).toContain('"id": "f2",\n    "title": "Değerlendirme",\n    "aim": "Antrenör puanlama ve yorumlar",\n    "blockedBy": [\n      "f4"\n    ],\n    "notes":');
    expect(md).toContain('"id": "f1-t3",\n        "title": "Fotoğraf yükleme",\n        "repo": "mobile"');
  });

  it('omits absent optionals entirely — no null placeholders', () => {
    const md = buildRoadmapMd({ workspaceSlug: 'w', title: 'T', fazlar: [{ id: 'f0', title: 'A', blockedBy: [], tasks: [{ id: 'f0-t1', title: 'x' }] }] });
    expect(md).not.toContain('"aim"');
    expect(md).not.toContain('"repo"');
    expect(md).not.toContain('null');
  });
});

describe('roadmapDiagnostics — hand-edit errors, by name (validate + the invalid view)', () => {
  it('a clean antreo document → no diagnostics', () => {
    expect(roadmapDiagnostics(antreoMd, ctx)).toEqual([]);
  });

  it('no_fence / bad_json / bad_element surface as single errors', () => {
    expect(roadmapDiagnostics(doc(''), ctx)).toEqual([expect.objectContaining({ code: 'no_fence', severity: 'error' })]);
    expect(roadmapDiagnostics(doc('[oops'), ctx)).toEqual([expect.objectContaining({ code: 'bad_json', severity: 'error' })]);
    const bad = doc(JSON.stringify([{ id: 'f0', blockedBy: [], tasks: [] }]));
    expect(roadmapDiagnostics(bad, ctx)).toEqual([expect.objectContaining({ code: 'bad_element', severity: 'error' })]);
  });

  it('duplicate_id — one namespace for faz and task ids', () => {
    const dup = doc(JSON.stringify([
      { id: 'f1', title: 'A', blockedBy: [], tasks: [{ id: 'f1-t1', title: 'x' }] },
      { id: 'f1-t1', title: 'B', blockedBy: [], tasks: [] },
    ]));
    const d = roadmapDiagnostics(dup, ctx);
    expect(d).toContainEqual(expect.objectContaining({ code: 'duplicate_id', severity: 'error', detail: 'f1-t1' }));
  });

  it('bad_id_shape — the ^[a-z0-9][a-z0-9-]*$ rule, for faz and task ids alike', () => {
    const md = doc(JSON.stringify([{ id: 'F1', title: 'A', blockedBy: [], tasks: [{ id: 'x y', title: 't' }] }]));
    const d = roadmapDiagnostics(md, ctx);
    expect(d).toContainEqual(expect.objectContaining({ code: 'bad_id_shape', detail: 'F1' }));
    expect(d).toContainEqual(expect.objectContaining({ code: 'bad_id_shape', detail: 'x y' }));
  });

  it('empty_title — a whitespace-only title names its element path', () => {
    const md = doc(JSON.stringify([{ id: 'f0', title: '  ', blockedBy: [], tasks: [{ id: 'f0-t1', title: 'x' }, { id: 'f0-t2', title: '' }] }]));
    const d = roadmapDiagnostics(md, ctx);
    expect(d).toContainEqual(expect.objectContaining({ code: 'empty_title', detail: 'f0' }));
    expect(d).toContainEqual(expect.objectContaining({ code: 'empty_title', detail: 'f0-t2' }));
  });

  it('unknown_blocked_by — a ref no faz carries', () => {
    const md = doc(JSON.stringify([{ id: 'f0', title: 'A', blockedBy: ['f9'], tasks: [] }]));
    expect(roadmapDiagnostics(md, ctx)).toEqual([expect.objectContaining({ code: 'unknown_blocked_by', severity: 'error' })]);
  });

  it('self_blocked_by — blocking yourself is an error, not unknown', () => {
    const md = doc(JSON.stringify([{ id: 'f0', title: 'A', blockedBy: ['f0'], tasks: [] }]));
    expect(roadmapDiagnostics(md, ctx)).toEqual([expect.objectContaining({ code: 'self_blocked_by', severity: 'error', detail: 'f0' })]);
  });

  it('cyclic_blocked_by — a 2-cycle is ONE warning naming both members (both render bekliyor)', () => {
    const md = doc(JSON.stringify([
      { id: 'fa', title: 'A', blockedBy: ['fb'], tasks: [] },
      { id: 'fb', title: 'B', blockedBy: ['fa'], tasks: [] },
    ]));
    const d = roadmapDiagnostics(md, ctx);
    expect(d).toEqual([expect.objectContaining({ code: 'cyclic_blocked_by', severity: 'warning' })]);
    expect(d[0]!.detail).toContain('fa');
    expect(d[0]!.detail).toContain('fb');
  });

  it('front_matter_mismatch — a foreign workspace roadmap names both slugs', () => {
    const md = doc('[]', '---\nworkspace: other-ws\ntitle: T\n---\n\n');
    expect(roadmapDiagnostics(md, ctx)).toEqual([expect.objectContaining({ code: 'front_matter_mismatch', severity: 'error' })]);
  });

  it('unknown_repo — a task repo outside the workspace is a WARNING (one typo, one task)', () => {
    const md = doc(JSON.stringify([{ id: 'f0', title: 'A', blockedBy: [], tasks: [{ id: 'f0-t1', title: 'x', repo: 'web' }] }]));
    expect(roadmapDiagnostics(md, ctx)).toEqual([expect.objectContaining({ code: 'unknown_repo', severity: 'warning', detail: expect.stringContaining('web') })]);
  });

  it('diagnostics are ordered: parse errors alone; then structural, in document order', () => {
    const md = doc(JSON.stringify([
      { id: 'f0', title: '', blockedBy: ['f7'], tasks: [] },
      { id: 'f0', title: 'B', blockedBy: [], tasks: [] },
    ]));
    const codes = roadmapDiagnostics(md, ctx).map((d) => d.code);
    expect(codes).toEqual(['empty_title', 'unknown_blocked_by', 'duplicate_id']);
  });
});

describe("nextFazId / nextTaskId — minting under the document's uniqueness rule", () => {
  it('nextFazId: [] → f0; gaps are honest (f0,f1,f2,f4 → f5); non-f ids ignored', () => {
    expect(nextFazId([])).toBe('f0');
    expect(nextFazId(antreoFazlar)).toBe('f5'); // f0,f1,f2,f4 present
    expect(nextFazId([{ id: 'alpha', title: 'A', blockedBy: [], tasks: [] }])).toBe('f0');
  });

  it('nextTaskId: sequential within the faz; unknown faz starts at t1', () => {
    expect(nextTaskId('f1', antreoFazlar)).toBe('f1-t5');
    expect(nextTaskId('f9', antreoFazlar)).toBe('f9-t1');
  });

  it('nextTaskId bumps past a cross-faz collision (a hand-named id elsewhere cannot be shadowed)', () => {
    const withCollision: FazSpec[] = [
      { id: 'f0', title: 'A', blockedBy: [], tasks: [{ id: 'f1-t2', title: 'hand-named' }] },
      { id: 'f1', title: 'B', blockedBy: [], tasks: [{ id: 'f1-t1', title: 'x' }] },
    ];
    expect(nextTaskId('f1', withCollision)).toBe('f1-t3');
  });
});

describe("normalizeDocsRoot — the structure-root setting's arithmetic", () => {
  it('accepts and normalizes safe relative roots', () => {
    expect(normalizeDocsRoot('docs')).toBe('docs');
    expect(normalizeDocsRoot('.docket')).toBe('.docket');
    expect(normalizeDocsRoot('docs/roadmap')).toBe('docs/roadmap');
    expect(normalizeDocsRoot('  docs/  ')).toBe('docs');
    expect(normalizeDocsRoot('./docs')).toBe('docs');
    expect(normalizeDocsRoot('docs/')).toBe('docs');
    expect(DEFAULT_DOCS_ROOT).toBe('docs');
  });

  it('rejects escapes, absolutes, empties and doubled slashes → undefined (fail-open to the default)', () => {
    for (const bad of ['../x', '/abs', '', '   ', '.', '..', 'a//b', 'docs/../x', 'docs x']) {
      expect(normalizeDocsRoot(bad)).toBeUndefined();
    }
  });
});
