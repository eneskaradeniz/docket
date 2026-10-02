// stores/work-order-code.ts — the one pure work-order code formatter (U-22): the locale's
// prefix (TR İE-, EN WO-, label key workOrder.codePrefix) plus the A-29 number, left-padded
// with zeros to four digits. A number above 9999 is shown in full, never truncated. No screen
// builds a code itself; every surface renders through this helper.
import { t, type Locale } from '../labels/t';

export const formatWorkOrderCode = (number: number, locale: Locale): string =>
  `${t(locale, 'workOrder.codePrefix')}${String(number).padStart(4, '0')}`;
