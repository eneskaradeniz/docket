import { describe, expect, it } from 'vitest';

import { parseSlug } from './ids';
import { slugFromName } from './slug-from-name';

const NONE: ReadonlySet<string> = new Set();
const slug = (name: string, taken: ReadonlySet<string> = NONE): string => slugFromName<'project'>(name, taken);

describe('slugFromName', () => {
  it('R-59: the fixed Turkish map turns İ I ı Ğ ğ Ü ü Ş ş Ö ö Ç ç into ASCII', () => {
    expect(slug('İIı')).toBe('iii');
    expect(slug('Ğğ Üü Şş Öö Çç')).toBe('gg-uu-ss-oo-cc');
    expect(slug('Çalışma Alanı')).toBe('calisma-alani');
  });

  it('R-59: NFKD decomposition drops combining marks and lower-cases', () => {
    expect(slug('Café Ünïcode')).toBe('cafe-unicode');
    expect(slug('ＡＢＣ')).toBe('abc');
  });

  it('R-59: every run of characters outside [a-z0-9] becomes one hyphen', () => {
    expect(slug('a   b___c...d')).toBe('a-b-c-d');
    expect(slug('x/y\\z')).toBe('x-y-z');
  });

  it('R-59: leading and trailing hyphens are trimmed', () => {
    expect(slug('  --Hello World!! ')).toBe('hello-world');
  });

  it('R-59: the result is cut to 63 characters and trimmed again', () => {
    expect(slug('a'.repeat(100))).toBe('a'.repeat(63));
    expect(slug(`${'a'.repeat(62)} bbb`)).toBe('a'.repeat(62));
  });

  it('R-59: an empty result is "project"', () => {
    expect(slug('')).toBe('project');
    expect(slug('!!! ???')).toBe('project');
    expect(slug('日本語')).toBe('project');
  });

  it('R-59: a taken result gets -2, -3, … with the first free number', () => {
    expect(slug('Atölye', new Set(['atolye']))).toBe('atolye-2');
    expect(slug('Atölye', new Set(['atolye', 'atolye-2']))).toBe('atolye-3');
    expect(slug('Atölye', new Set(['atolye', 'atolye-3']))).toBe('atolye-2');
    expect(slug('', new Set(['project']))).toBe('project-2');
  });

  it('R-59: on a collision the base is cut so the whole stays within 63 characters', () => {
    const base = 'a'.repeat(63);
    const second = `${'a'.repeat(61)}-2`;
    expect(slug('a'.repeat(80), new Set([base]))).toBe(second);
    expect(second.length).toBe(63);
    expect(slug('a'.repeat(80), new Set([base, second]))).toBe(`${'a'.repeat(61)}-3`);
  });

  it('R-59: every result passes parseSlug', () => {
    const names = ['', 'İstanbul', '  ', 'a'.repeat(200), '9 lives', '--', 'Ünal & Çağrı', '日本', `${'x'.repeat(62)} y`];
    for (const name of names) {
      const first = slug(name);
      const second = slug(name, new Set([first]));
      const third = slug(name, new Set([first, second]));
      for (const candidate of [first, second, third]) {
        expect(parseSlug(candidate).ok).toBe(true);
        expect(candidate.length).toBeLessThanOrEqual(63);
      }
      expect(new Set([first, second, third]).size).toBe(3);
    }
  });
});
