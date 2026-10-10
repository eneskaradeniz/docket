// Turkish-aware search folding, shared by every list that filters by typed text. The case mapping
// is written out instead of calling toLocaleLowerCase('tr'): the result must not depend on the
// host's ICU data or locale.

/** The canonical form both sides of a comparison are folded to. İ, I, ı and i all become i. */
export function foldSearch(text: string): string {
  // The dotted capital and the dotless capital are replaced BEFORE lower-casing: the default
  // lower-casing would turn İ into "i" plus a combining dot and I into a plain i.
  const lowered = text.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  const stripped = lowered.normalize('NFD').replace(/\p{M}/gu, '');
  return stripped
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();
}

const SOFTENED: Readonly<Record<string, string>> = { k: 'g', p: 'b', t: 'd' };
const SOFTENING_MIN_LENGTH = 3;

/** Consonant softening before a vowel suffix (kitap → kitabı): only the last character, only for
 *  a token long enough that the guess is not noise. */
const softened = (token: string): string | undefined => {
  if (token.length < SOFTENING_MIN_LENGTH) return undefined;
  const replacement = SOFTENED[token.slice(-1)];
  return replacement === undefined ? undefined : token.slice(0, -1) + replacement;
};

/** Every whitespace-separated token of the query must occur in the haystack as a plain
 *  substring (or in its softened form). An empty query matches everything. */
export function matchesSearch(haystack: string, query: string): boolean {
  const folded = foldSearch(haystack);
  const tokens = foldSearch(query)
    .split(' ')
    .filter((token) => token !== '');
  return tokens.every((token) => {
    if (folded.includes(token)) return true;
    const variant = softened(token);
    return variant !== undefined && folded.includes(variant);
  });
}
