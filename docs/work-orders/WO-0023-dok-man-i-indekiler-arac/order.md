---
id: WO-0023
title: Doküman İçindekiler aracı
workspace: docket
status: draft
mode: plan
review: light
review_mode: gates
tracks:
  - repo: docket
    depends_on: []
---

# WO-0023 — Doküman İçindekiler aracı

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Notes](#notes)

## Objective

AMAÇ: docs/ klasöründeki her .md dosyasının başına otomatik bir İçindekiler (Table of Contents) bölümü ekle.

KAPSAM: yalnızca docs/ altındaki .md dosyaları; kod, test ve yapılandırma dosyalarına dokunma.
İÇİNDEKİLER: mevcut başlık (## ve ###) satırlarından üretilir; zaten İçindekiler varsa güncelle, yoksa başa ekle.
DOĞRULAMA: her değişen dosyada başlık linklerinin gerçek başlıklara işaret ettiğini kontrol et.
ÇIKTI: işlem sonrası değişen dosya listesini raporla.

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
