---
id: WO-0024
title: CLI is emri olusturma (bootstrap)
workspace: docket
status: draft
mode: plan
review: light
review_mode: gates
tracks:
  - repo: docket
    depends_on: []
---

# WO-0024 — CLI is emri olusturma (bootstrap)

## Objective

AMAÇ: docket CLI kendisi bir workspace ve is emri olusturabilsin — GUI hic acilmadan uc
  tan uca (TD-032).

  KAPSAM: yalnizca src/cli/ ve testleri; store/port katmanlarina dokunma
  (createWorkspace/createWorkOrder zaten var).

  ISTENEN:
  1) `create-workspace --label L --repo PATH [--decision-store PATH]` komutu
  2) `create-work-order --workspace W --title T [--description D] [--track repo]...
  [--review-mode gates|every-step]` komutu
  3) help guncelle; hatalarda anlasilir mesaj + rc!=0
  4) arguman→girdi esleyicileri saf fonksiyonlar olarak ayri dosyada; testleri yaz
  (IPC/DB gerektirmesin)

  DOGROUTLAMA: npm test + typecheck + check:boundaries yesil; sandbox db uzerinde elle
  komut denemesi.
  NOT: mevcut komut yapisini izle; yeni bagimlilik ekleme.

## Context

- _(added during planning)_

## Scope

In scope:
-

Out of scope:
-

## Acceptance criteria

1.

## Evidence required

- plan_approval: architect verdict, `plan.md` committed
- pr_open: PR URL, head sha
- ci_green: all required checks `success`
- verification: verifier report, all `path:line` pointers resolve at head sha
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (commit sha)

## Notes

Created via Docket.

## Closure

LI bootstrap tamamlandi (TD-032 onyukleme yarisi odendi). Bu is Docket'in kendi   pipeline'iyla uretildi: plan (1 itiraz + steps-fence duzeltmesi) → 2 adim → 2 mimar   denetimi → PR #29 → merge. TD-035 acildi (numaralandirma/PK carpmasi). Maliyet: $6.80.

_Closed 2026-08-15T17:15:06.789Z at 1869d5f948e4f09c7f3c982fe508a0670d227851_
