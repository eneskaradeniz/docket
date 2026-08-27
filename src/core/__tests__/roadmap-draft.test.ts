import { describe, expect, it } from 'vitest';
import { draftSummaryOf, roadmapDraftPrompt } from '../roadmap-draft';
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
