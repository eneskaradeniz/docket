import { describe, expect, it } from 'vitest';
import { draftDocGroups, draftStorePaths, draftSummaryOf, roadmapDraftPrompt } from '../roadmap-draft';
import { buildRoadmapMd, parseRoadmapMd, type FazSpec } from '../roadmap-md';

const INPUT = {
  goalNote: 'Mevcut faz dokümanlarından yol haritasını çıkar. Bağımlılıkları koru.',
  docPaths: ['/tmp/repo/docs/faz-0-altyapi.md', '/tmp/repo/docs/faz-1-profil.md'],
  workspaceSlug: 'antreo-app',
  knownRepos: ['api', 'mobile'],
  roadmapMdPath: '/tmp/repo/docs/roadmap.md',
};

const faz = (id: string, blockedBy: string[] = [], tasks = 1): FazSpec => ({
  id,
  title: `Faz ${id}`,
  blockedBy,
  tasks: Array.from({ length: tasks }, (_, i) => ({ id: `${id}-t${i + 1}`, title: `Görev ${i + 1}` })),
});

describe('roadmapDraftPrompt — ONE mechanism, paths never contents (WO-0050 / D5)', () => {
  const prompt = roadmapDraftPrompt(INPUT);

  it('carries the goal note verbatim', () => {
    expect(prompt).toContain(INPUT.goalNote);
  });

  it('carries each source document as a PATH line — the import branch', () => {
    for (const p of INPUT.docPaths) {
      expect(prompt).toContain(`- ${p}`);
    }
    expect(prompt).toContain('read these yourself with your file tools');
  });

  it('states that the documents outrank the note where they disagree', () => {
    expect(prompt).toContain('the goal note states intent, the documents state fact');
  });

  it('names the workspace, the file destination, and the known repo slugs', () => {
    expect(prompt).toContain('antreo-app');
    expect(prompt).toContain(INPUT.roadmapMdPath);
    expect(prompt).toContain('api, mobile');
  });

  it('empty doc list takes the generate branch — no path lines, no import header', () => {
    const p = roadmapDraftPrompt({ ...INPUT, docPaths: [] });
    expect(p).toContain('GENERATE');
    expect(p).not.toContain('- /');
    expect(p).not.toContain('read these yourself');
  });

  it('omits the repo field from the example when the workspace has no repos', () => {
    const p = roadmapDraftPrompt({ ...INPUT, knownRepos: [], docPaths: [] });
    expect(p).toContain('(none — omit repo fields)');
    expect(p).not.toContain('"repo":');
  });

  it('teaches a fence that itself parses (the model copies a valid example)', () => {
    const parsed = parseRoadmapMd(prompt);
    expect(parsed.parseError).toBeUndefined();
    expect(parsed.fazlar[0]?.id).toBe('f0');
    expect(parsed.fazlar[0]?.tasks[0]?.id).toBe('f0-t1');
  });

  it('states the parse rules the re-read enforces', () => {
    expect(prompt).toContain('EXACTLY ONE ```fazlar fence');
    expect(prompt).toContain('UNIQUE across the whole document');
    expect(prompt).toContain('blockedBy" names only faz ids present');
    expect(prompt).toContain('only from the known repo slugs');
    expect(prompt).toContain('Status appears NOWHERE');
  });

  it('carries the ask-as-text clause, the stop notice, and the objection-resume contract', () => {
    expect(prompt).toContain('ask ONE concise question as plain text');
    expect(prompt).toContain('Plan submitted. STOP');
    expect(prompt).toContain('NEVER investigate approval status');
    // İtiraz et (D11): an objection rides the resume; the REVISED document is the answer.
    expect(prompt).toContain('objection');
    expect(prompt).toContain('REVISED');
  });
});

// ===== WO-0051 — the channel composition (D1–D5) =====
// The prompt's additions are NEGATIVE by contract: the union stays ONE unlabelled list, and
// the exploration clause is a single optional sentence — pinned by counting, not by contains.

describe('roadmapDraftPrompt — the exploration clause (WO-0051 / D5)', () => {
  const MARK = 'explore the repository yourself';

  it('appears EXACTLY ONCE when freeExplore is true (the import branch)', () => {
    const p = roadmapDraftPrompt({ ...INPUT, freeExplore: true });
    expect(p.split(MARK)).toHaveLength(2); // exactly one occurrence
  });

  it('appears in the GENERATE branch too (empty docs + exploration)', () => {
    const p = roadmapDraftPrompt({ ...INPUT, docPaths: [], freeExplore: true });
    expect(p.split(MARK)).toHaveLength(2);
    expect(p).toContain('GENERATE');
  });

  it('is ABSENT when freeExplore is false or omitted — the ordinary deterministic prompt', () => {
    expect(roadmapDraftPrompt(INPUT)).not.toContain(MARK);
    expect(roadmapDraftPrompt({ ...INPUT, freeExplore: false })).not.toContain(MARK);
  });
});

describe('roadmapDraftPrompt — the path UNION is one unlabelled list (WO-0051 / D1)', () => {
  it('carries a store path and an external path verbatim, with no channel labels', () => {
    const p = roadmapDraftPrompt({
      ...INPUT,
      docPaths: ['docs/faz-0-altyapi.md', '/Users/op/source/docket/ROADMAP.md'],
    });
    expect(p).toContain('- docs/faz-0-altyapi.md');
    expect(p).toContain('- /Users/op/source/docket/ROADMAP.md');
    expect(p).not.toContain('dışarıdan');
    expect(p).not.toContain('store scan');
  });
});

describe("draftDocGroups — the scan's noise unit is the first directory segment (WO-0051 / D3)", () => {
  it('a pure-root (flat) scan → one root group, NOT grouped — the dialog renders file rows (frame 01)', () => {
    const { groups, grouped } = draftDocGroups(['faz-2-gorusme.md', 'faz-0-altyapi.md']);
    expect(grouped).toBe(false);
    expect(groups).toEqual([{ key: '', files: ['faz-0-altyapi.md', 'faz-2-gorusme.md'] }]);
  });

  it('a multi-directory scan → sorted groups, root first — group rows (frame 02)', () => {
    const { groups, grouped } = draftDocGroups([
      'work-orders/WO-0001-x/order.md',
      'adr/ADR-0002.md',
      'PRODUCT.md',
      'adr/ADR-0001.md',
    ]);
    expect(grouped).toBe(true);
    expect(groups.map((g) => g.key)).toEqual(['', 'adr', 'work-orders']);
    expect(groups[0]?.files).toEqual(['PRODUCT.md']);
    expect(groups[1]?.files).toEqual(['adr/ADR-0001.md', 'adr/ADR-0002.md']);
  });

  it('deeper nesting stays at the FIRST segment — the work-orders group is one touch (frame 02)', () => {
    const { groups } = draftDocGroups(['work-orders/WO-0001-x/order.md', 'work-orders/WO-0002-y/order.md']);
    expect(groups).toEqual([
      { key: 'work-orders', files: ['work-orders/WO-0001-x/order.md', 'work-orders/WO-0002-y/order.md'] },
    ]);
  });

  it('a lone non-root group is still grouped (its files are not root rows)', () => {
    expect(draftDocGroups(['adr/ADR-0001.md'])).toEqual({ groups: [{ key: 'adr', files: ['adr/ADR-0001.md'] }], grouped: true });
  });

  it('an empty scan → no groups, not grouped (the zero-doc floor)', () => {
    expect(draftDocGroups([])).toEqual({ groups: [], grouped: false });
  });
});

describe('draftStorePaths — the prompt-path join (WO-0051 / D3)', () => {
  it("joins the root with scan-relative files — 'docs' and 'docs/' both give clean paths", () => {
    expect(draftStorePaths('docs', ['adr/x.md', 'faz-0.md'])).toEqual(['docs/adr/x.md', 'docs/faz-0.md']);
    expect(draftStorePaths('docs/', ['adr/x.md'])).toEqual(['docs/adr/x.md']);
    expect(draftStorePaths('.docket', ['notlar/gorusme.md'])).toEqual(['.docket/notlar/gorusme.md']);
  });

  it('never produces a double slash, whatever trailing slashes the setting carries', () => {
    expect(draftStorePaths('docs//', ['x.md'])).toEqual(['docs/x.md']);
  });
});

describe("draftSummaryOf — the TASLAK card's summary figures (D11)", () => {
  it('counts fazlar, tasks, and dependency chains', () => {
    const md = buildRoadmapMd({
      workspaceSlug: 'antreo-app',
      title: 'Yol Haritası',
      fazlar: [faz('f0', [], 2), faz('f2', ['f4'], 1), faz('f4', ['f1'], 1), faz('f1', [], 3)],
    });
    expect(draftSummaryOf(md)).toEqual({ fazCount: 4, taskCount: 7, chainCount: 1 });
  });

  it('separate blocker clusters are separate chains', () => {
    const md = buildRoadmapMd({
      workspaceSlug: 'w',
      title: 't',
      fazlar: [faz('a', ['b']), faz('b'), faz('c', ['d']), faz('d')],
    });
    expect(draftSummaryOf(md)).toEqual({ fazCount: 4, taskCount: 4, chainCount: 2 });
  });

  it('no blockers → zero chains', () => {
    const md = buildRoadmapMd({ workspaceSlug: 'w', title: 't', fazlar: [faz('f0'), faz('f1')] });
    expect(draftSummaryOf(md)).toEqual({ fazCount: 2, taskCount: 2, chainCount: 0 });
  });

  it('an unparseable proposal returns the named parse error — never invented figures', () => {
    expect(draftSummaryOf('no fence here')).toEqual({ parseError: { reason: 'no_fence' } });
    expect(draftSummaryOf('```fazlar\n{not json}\n```')).toMatchObject({ parseError: { reason: 'bad_json' } });
  });
});
