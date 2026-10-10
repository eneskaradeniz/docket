import { describe, expect, it } from 'vitest';

import { foldSearch, matchesSearch } from './search';

describe('foldSearch', () => {
  it('R-103: İ, I, ı and i all fold to i, whatever the host locale', () => {
    expect(foldSearch('İ')).toBe('i');
    expect(foldSearch('I')).toBe('i');
    expect(foldSearch('ı')).toBe('i');
    expect(foldSearch('i')).toBe('i');
    expect(foldSearch('İSTEK')).toBe(foldSearch('istek'));
    expect(foldSearch('ISPARTA ıspanak')).toBe('isparta ispanak');
  });

  it('R-103: ğ ş ç ö ü and their capitals fold to ASCII', () => {
    expect(foldSearch('ĞŞÇÖÜ ğşçöü')).toBe('gscou gscou');
    expect(foldSearch('Giriş Ekranı')).toBe('giris ekrani');
  });

  it('R-103: combining marks are dropped and whitespace runs collapse and trim', () => {
    expect(foldSearch('Café')).toBe('cafe');
    expect(foldSearch('i̇')).toBe('i');
    expect(foldSearch('  a \t\n b   ')).toBe('a b');
    expect(foldSearch('   ')).toBe('');
  });

  it('R-103: it is idempotent', () => {
    for (const text of ['İSTEK Işık ığ', ' Çok  Güzel\tŞey ', 'ie-0012', 'ÂÊ']) {
      expect(foldSearch(foldSearch(text))).toBe(foldSearch(text));
    }
  });
});

describe('matchesSearch', () => {
  it('R-104: an empty or whitespace query matches everything', () => {
    expect(matchesSearch('anything', '')).toBe(true);
    expect(matchesSearch('', '  \t ')).toBe(true);
  });

  it('R-104: every token must be found as a substring of the folded haystack', () => {
    expect(matchesSearch('Giriş Ekranı taslağı', 'giris ekrani')).toBe(true);
    expect(matchesSearch('Giriş Ekranı', 'giris kayit')).toBe(false);
    expect(matchesSearch('İSTEK listesi', 'istek')).toBe(true);
    expect(matchesSearch('İstek', 'İSTEK')).toBe(true);
    expect(matchesSearch('İE-0012', 'ie-0012')).toBe(true);
  });

  it('R-104: matching is plain substring, not word start', () => {
    expect(matchesSearch('kalem', 'kal')).toBe(true);
    expect(matchesSearch('kalem', 'lem')).toBe(true);
    expect(matchesSearch('kalem', 'kalemi')).toBe(false);
  });

  it('R-104: the last character k, p, t of a token also matches its softened form', () => {
    expect(matchesSearch('taslağı', 'taslak')).toBe(true);
    expect(matchesSearch('kitabı', 'kitap')).toBe(true);
    expect(matchesSearch('kanadı', 'kanat')).toBe(true);
    expect(matchesSearch('rengi', 'renk')).toBe(true);
  });

  it('R-104: the variant needs a token of at least 3 characters and changes only the last one', () => {
    expect(matchesSearch('abı', 'ap')).toBe(false);
    expect(matchesSearch('adı', 'at')).toBe(false);
    expect(matchesSearch('tapag', 'tapak')).toBe(true);
    // Only the last character is softened: "tapak" would need two changes here.
    expect(matchesSearch('tabag', 'tapak')).toBe(false);
    // Other final letters get no variant.
    expect(matchesSearch('kalemi', 'kalem')).toBe(true);
    expect(matchesSearch('kitaba', 'kitaz')).toBe(false);
  });

  it('R-104: the variant is per token and no fuzzy matching exists', () => {
    expect(matchesSearch('taslağı kitabı', 'taslak kitap')).toBe(true);
    expect(matchesSearch('taslağı', 'taslak kitap')).toBe(false);
    expect(matchesSearch('taslak', 'taslaq')).toBe(false);
  });
});
