// labels.test.ts — U-1 (typed keys, complete bundles) and U-9 (Turkish fallback for a missing
// English key). Node environment: pure data and resolver, no DOM.
import { describe, expect, it } from 'vitest';

import { EN } from './en';
import { TR } from './tr';
import { LABEL_KEYS, type LabelBundle } from './keys';
import { DEFAULT_LOCALE, resolveLabel, t, type LocaleBundles } from './t';

describe('labels', () => {
  it('U-1: every bundle carries exactly the typed keys — none missing, none extra', () => {
    const keySet = new Set<string>(LABEL_KEYS);
    expect(keySet.size).toBe(LABEL_KEYS.length);

    const bundles: readonly [name: string, bundle: LabelBundle][] = [
      ['tr', TR],
      ['en', EN],
    ];
    for (const [name, bundle] of bundles) {
      expect(Object.keys(bundle).sort(), `${name} bundle keys`).toEqual([...LABEL_KEYS].sort());
      for (const key of LABEL_KEYS) {
        expect(typeof bundle[key], `${name}:${key} is a string`).toBe('string');
        expect(bundle[key].length, `${name}:${key} is non-empty`).toBeGreaterThan(0);
      }
    }
  });

  it('U-1: the resolver reads the active bundle without touching a DOM', () => {
    expect(t('tr', 'error.empty_title')).toBe(TR['error.empty_title']);
    expect(t('en', 'error.empty_title')).toBe(EN['error.empty_title']);
    expect(TR['error.empty_title']).not.toBe(EN['error.empty_title']);
  });

  it('U-9: a key missing from the English bundle falls back to Turkish', () => {
    const partial: LocaleBundles = {
      tr: TR,
      en: { ...EN, 'error.stale': undefined },
    };
    expect(resolveLabel(partial, 'en', 'error.stale')).toBe(TR['error.stale']);
    // A key present in both resolves from the active locale, not the fallback.
    expect(resolveLabel(partial, 'en', 'error.not_found')).toBe(EN['error.not_found']);
    // The default locale is Turkish.
    expect(DEFAULT_LOCALE).toBe('tr');
  });

  it('U-151: the Turkish bundle never says "artifact" — the library is Çıktılar — while English keeps Artifacts', () => {
    for (const [key, value] of Object.entries(TR)) expect(value.toLowerCase(), key).not.toContain('artifact');
    expect(TR['nav.library']).toBe('Çıktılar');
    expect(EN['nav.library']).toBe('Artifacts');
  });

  it('U-238: every detail.* key is complete in both bundles', () => {
    // Completeness for the whole detail.* family is U-1's own loop; this pins the family exists
    // in both voices.
    for (const key of LABEL_KEYS) {
      if (!key.startsWith('detail.')) continue;
      expect(TR[key], `tr:${key}`).toBeTypeOf('string');
      expect(EN[key], `en:${key}`).not.toBeUndefined();
    }
  });

  it('U-228: the trailing “…” marks only the controls that open a further step (label-bundle scan)', () => {
    // “Yükleniyor…” is progress punctuation, not a control; every dotted CONTROL opens a further
    // step (the reject box, the close confirmation, the stop confirm, the steer note dialog and
    // the git merge confirm — the explicit human step).
    const dotted = Object.entries(TR)
      .filter(([key, value]) => key.startsWith('detail.') && value.endsWith('…') && key !== 'detail.loading')
      .map(([key]) => key);
    expect(dotted.sort()).toEqual([
      'detail.close.open',
      'detail.git.mergeOpen',
      'detail.steer.open',
      'detail.stop.open',
      'detail.zone.rejectOpen',
    ]);
  });
});
