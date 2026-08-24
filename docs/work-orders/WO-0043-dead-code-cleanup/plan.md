# WO-0043 plan — ordered deletions, each step leaves the tree green

Design by a plan agent that re-verified every audit claim against `ff07186` (clean `main`).
Gate after every step: `npm run typecheck && npm test` (S2 adds `npm run build`; S10/S11 add the
full e2e ladder). Full ladder twice: once after S8 (riskiest code step), once at PR head.

## Audit corrections (the deletion set is corrected, not the audit's raw list)

1. All seven `woPhase*` keys are alive — `phaseLabelText` (tr.ts:796-813) switches over every
   `WoPhase`; called by `DetailStrip.tsx:155`.
2. `cardJustWritten` is alive — `cardReasonText` returns it (tr.ts:106); rendered by
   `WorkOrderCard.tsx:57`.
3. `docs/work-orders/WO-0025-test/` is TRACKED with content (order.md + plan.md, id WO-0025,
   title "test") — a deletion ruling, not a mechanical step.
4. Structural: `check-boundaries.mjs` exempts `__tests__`/`*.test.ts` from c2a/c2c/c4 but c2b
   (the `dateapp` literal) has NO exemption — `fixtures/workspaces.ts` lives in adapters or nowhere.

Net: 10 dead UI keys + the `askingRole` family (11 UI members), not the audit's 19 keys.

## Steps

- **S1** Delete `src/adapters/fixtures/docs.ts`; in `fixtures/index.ts` drop the import (line 4),
  the `workOrderDocs` export, and reword the header (workspaces remain the reseed seed; work-order
  constants are core-test fixtures). Ride-along (review round 1): the twin stale "reads fixtures in
  M2" sentences in `src/adapters/store/index.ts:8-9` and `src/core/source.ts:63` reworded to the
  WO-0016 working-tree reality.
- **S2** Delete `src/ui/kit/Tabs.tsx` + `src/ui/kit/ScrollArea.tsx`; drop their re-exports in
  `kit/index.ts` (lines 8 and 11 at HEAD); `npm uninstall @radix-ui/react-scroll-area
  @radix-ui/react-tabs`. e2e's tablist/tab asserts are zero-count — safe.
- **S3** Delete `src/ui/components/detail/MarkdownDoc.tsx`; reword the comment citing it in
  `MarkdownBody.tsx:7-8`.
- **S4** (core, test-first pairing) Delete the SADE cluster in `src/core/runner.ts` — section
  comment ~459-463, `SimplePhase` 465-477, `classifyTool` 479-500, `simplePhaseFromState`
  502-~524 — and in `runner.test.ts` the describe block 296-338 + the `simplePhaseFromState`
  import (line 11).
- **S5** (TD-006) `types.ts`: drop `| 'update_docs'` (213) and `| 'pointers_unresolved'` (221).
  Both bundles: drop `ACTION_LABELS.update_docs` (tr:80/en:77), `ABSENT_REASON_LABELS.
  pointers_unresolved` (tr:90/en:87); fix the stale ActionRail comment at tr.ts:129-131. The
  `Record<ActionIntent,…>`/`Record<AbsentReason,…>` maps make typecheck prove completeness.
- **S6** (gate: the dynamic-access greps below must be zero first) Delete from both bundles:
  `closedDrawer` (tr:396/en:363), `wsDecisionStore` (428/389), `stepScopeAll` (489/437),
  `secFlow` (591/514), `secRecord` (592/515), `stepLiveMeta` (599/521), `secTracks` (655/552),
  `stepSegments` (713/602), `auditShowTranscript` (730/618), `auditHideTranscript` (731/619) —
  and the `askingRole` family in both files: the exported `askingRole` fn (tr:362/en:332), the
  `ASKING_ROLE` const (tr:367/en:336 — same edit; `noUnusedLocals` fails an orphan), the
  `UI.askingRole` member (tr:524/en:466), the bundle-list entry (tr:856/en:728). Attached
  comments ride along.
- **S7** Delete `OWNED_TABLES` — `src/adapters/store/schema.ts:138` (zero refs). Typechecks
  under `tsconfig.electron.json`.
- **S8** (fixtures, Option C) In `src/adapters/store/index.ts`: delete the exported
  `seedFixtureWorkOrders` (260-305 incl. comment block), change the import at line 24 to
  `{ workspaces }`, fix the file-header sentence (11-12). In `store.test.ts`: add a local
  `seedFixtureWorkOrders(db)` — the SQL body copied verbatim from store/index.ts:262-305 incl.
  the TD-023 comment on the `0, 0, 0` line — importing `workOrders` from `'../fixtures'` and
  `SEED_OBSERVED_AT` from `'./schema'`; call sites (:32 via fixtureStore(), :126, :163)
  unchanged. `workspaces.ts`/`reseedObserved` STAY (ADR-0010 coverage, c2b home, M3 hook).
- **S9** Delete `scripts/shot.mjs` (TD-011/TD-018; no npm script references it); `rmdir` the
  empty untracked dirs `docs/work-orders/WO-0026-test`, `WO-0027-test`,
  `WO-0007-electron-shell-scaffold/screenshots` (invisible to git).
- **S10** (TD-047) `index.html`: delete the two preconnects + the `fonts.googleapis.com`
  stylesheet (lines 7-12). Fonts ship via `@fontsource` (index.css:2-8); `IBM Plex Sans` is used
  by nothing (`--font-sans` is Manrope, index.css:36). Isolated revertible step; the shot
  comparison follows.
- **S11** `src/index.css` dead rules (zero markup refs; `.rlamp-*` is DYNAMIC — stays):
  `.panel-glide[data-state='active']` block + its comment (224-228); the `.flowtabs`/`.flowtab`/
  `.flowtab-n` group + section comment (~284-301); `.substrip-band`/`.subturn`/`.subfocus`
  (327-341); `.stepcard` + `:hover` + comment (436-441); `.segcell` + H-1 comment (499-501); in
  the `prefers-reduced-motion` group remove the `.stepcard,` (~780) and
  `.panel-glide[data-state='active'],` (~786) selectors and the separate `.segcell` rule
  (797-799).
- **S12** `git rm -r design-mock/` (its README: "once the design is ported… this directory is
  deleted"); ROADMAP header: drop the "lives in `design-mock/`" current-state sentence (historical
  per-WO mentions stay — records of their time).
- **S13** (stop-and-ask) `git rm -r docs/work-orders/WO-0025-test/` only if the operator rules
  deletion at the checkpoint. RESOLVED 2026-08-25: ruled "sil" — deleted. Numbering unaffected.

## S6 gate — dynamic-label-access greps (all must be zero)

```
grep -rn "UI\[" src/ui src/core --include='*.ts' --include='*.tsx'
grep -rn "labels\[\|bundle\[" src/ui --include='*.ts' --include='*.tsx'
grep -rn "\[key\]\|keyof Labels\|\[.*: keyof\|as keyof" src/ui --include='*.ts' --include='*.tsx'
grep -rn "Object\.keys(UI\|Object\.entries(UI\|Object\.values(UI" src/ui --include='*.ts' --include='*.tsx'
grep -rn "\.\.\.UI\|\.\.\.tr\b\|\.\.\.en\b\|\.\.\.labels" src/ui --include='*.ts' --include='*.tsx'
grep -rn "LABEL_BUNDLES\[" src/ui --include='*.ts' --include='*.tsx'
```

Known-safe hits: `LABEL_BUNDLES[locale]` in `locale.tsx` (fixed `'tr' | 'en'` union) and
`en[key as keyof typeof en]` inside `labels.test.ts` (the parity test iterating whatever tr has).
Per key, grep `\b<key>\b` INCLUDING `tr.ts`/`en.ts` and read every hit — a `UI.<key>` inside a
composer means the key is alive (this is what caught the audit's three false positives).

## TD-023 — deferred (out of scope)

Dropping NOT NULL columns needs the SQLite 12-step table rebuild in `migrate()` — a
behavior-bearing migration against operator databases, in the non-transactional regime TD-021
flags. Belongs to a store order with a legacy-DB migration test (pattern: store.test.ts:106-139).
S8 leaves a one-line addendum: the fixture seed's `cost_*` write now lives in the test; production's
only remaining write is `createWorkOrderRow`'s NOT NULL zeros (store/index.ts:769-771) — the rebuild
migration remains. Status stays open.

## Verification ladder + checkpoint

1. `npm run typecheck` 2. `npm test` 3. `npm run check:boundaries` 4. `npm run build`
5. `npm run test:ui` (46 specs; the 32 checked-in shots regenerate — any shift beyond timestamp
   noise is a finding; the only expected visual delta is S10's font provenance, ideally none).

Operator checkpoint before commit: launch the app; walk board (card language unchanged), DOSYA
detail (phase line, plan rows, step reports, Belgeler/Kaynaklar/Oturum), settings (en↔tr switch —
both edited bundles), theme. Show `git diff --stat`. WO-0025-test ruling here. Then commit → PR →
CI green (`ci_green` is not exempt — TD-012) → operator approves → merge.

## Risks

- R1 audit drift (materialized once — the 3 alive keys; the per-key in-bundle read + typecheck
  are the backstops). R2 e2e coupling checked both directions (no deleted class in selectors; the
  `Depolar`/`Karar deposu` asserts ride `wsGuardDs`/`wsDsMarker`, not the dead keys). R3 boundary
  checker untouched (S8's SQL moves into a test file — exempt paths). R4 font rendering — later
  `@font-face` wins, so removal should be neutral; isolated step if not. R5 `noUnusedLocals`
  catches orphans loudly (safety, not risk). R6 kit barrel has no other consumers. R7 empty dirs
  are local-only. R8 shots regenerate — the PR states the expected-delta rule.
