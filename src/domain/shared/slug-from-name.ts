// slugFromName — turns a user-typed name into a free slug (docs/v2/domain.md R-59).
import type { Slug } from './ids';

const MAX_LENGTH = 63;
const FALLBACK = 'project';

const TURKISH: Readonly<Record<string, string>> = {
  İ: 'i', I: 'i', ı: 'i', Ğ: 'g', ğ: 'g', Ü: 'u', ü: 'u', Ş: 's', ş: 's', Ö: 'o', ö: 'o', Ç: 'c', ç: 'c',
};

const trimHyphens = (text: string): string => text.replace(/^-+/, '').replace(/-+$/, '');

/** The result always matches the slug pattern and is not in `taken`. */
export function slugFromName<B extends string>(name: string, taken: ReadonlySet<string>): Slug<B> {
  const mapped = name.replace(/[İIıĞğÜüŞşÖöÇç]/g, (char) => TURKISH[char] ?? char);
  const ascii = mapped.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const hyphenated = trimHyphens(ascii.replace(/[^a-z0-9]+/g, '-'));
  const base = trimHyphens(hyphenated.slice(0, MAX_LENGTH)) || FALLBACK;
  if (!taken.has(base)) return base as Slug<B>;

  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const cut = trimHyphens(base.slice(0, MAX_LENGTH - suffix.length));
    const candidate = `${cut}${suffix}`;
    if (!taken.has(candidate)) return candidate as Slug<B>;
  }
}
