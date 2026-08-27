// src/core/__tests__/antreo-roadmap.ts — the shared antreo fixture (WO-0048): mockup frame-01's
// facts, pinned. Shared by the core derivation tests (roadmap.test.ts) and the store tests that
// build the same world on a real decision store — ONE fixture, two readers, no drift. NOT a test
// file (no .test suffix — vitest does not collect it).
import type { FazSpec } from '../roadmap-md';
import { buildRoadmapMd } from '../roadmap-md';

export const ANTREO_WORKSPACE = 'antreo-app';
export const ANTREO_REPOS = ['api', 'mobile', 'docs'];

/** Mockup frame-01 EXACTLY: f0 done, f1 running (WO-0012 on fotoğraf), f2 blocked by f4. */
export const antreoFazlar: FazSpec[] = [
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

/** The canonical document around the fence — built by the builder itself, so the fixture IS the
 * producer's output (a parse/build round-trip drift would fail the roadmap-md tests first). */
export const antreoRoadmapMd: string = buildRoadmapMd({
  workspaceSlug: ANTREO_WORKSPACE,
  title: 'Antreo Yol Haritası',
  prose: 'Antrenör puanlama ve rezervasyon platformu — fazlar, görevler ve bağımlılıklar.',
  fazlar: antreoFazlar,
});

export interface AntreoOrderFact {
  id: string;
  closed: boolean;
  costUsd: number;
  taskRef?: string;
}

/**
 * The WO facts the mockup's head line and faz metas pin: f0's five closed WOs ($12.40 = 3.10+4.20
 * +1.00+2.60+1.50, split 3+2 across its two tasks), WO-0012 open at $1.62 on f1-t3, one closed $0
 * WO on f1-t1 (reconciles f0's scoped cost with the head's $14.02), and three unlinked open WOs
 * (the görevsiz iş emri possibility) — head: `1/4 faz tamam · 4 açık iş emri · $14,02`.
 */
export const antreoOrderFacts: AntreoOrderFact[] = [
  { id: 'WO-0001', closed: true, costUsd: 3.1, taskRef: 'f0-t1' },
  { id: 'WO-0002', closed: true, costUsd: 4.2, taskRef: 'f0-t1' },
  { id: 'WO-0003', closed: true, costUsd: 1.0, taskRef: 'f0-t1' },
  { id: 'WO-0004', closed: true, costUsd: 2.6, taskRef: 'f0-t2' },
  { id: 'WO-0005', closed: true, costUsd: 1.5, taskRef: 'f0-t2' },
  { id: 'WO-0006', closed: true, costUsd: 0.0, taskRef: 'f1-t1' },
  { id: 'WO-0012', closed: false, costUsd: 1.62, taskRef: 'f1-t3' },
  { id: 'WO-0007', closed: false, costUsd: 0 },
  { id: 'WO-0008', closed: false, costUsd: 0 },
  { id: 'WO-0009', closed: false, costUsd: 0 },
];
