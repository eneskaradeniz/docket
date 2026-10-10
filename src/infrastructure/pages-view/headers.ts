// The header set every docket-page response carries. The CSP is the second wall behind the
// request filter: it lets a page run its own inline script and style but reach nothing outside
// its own origin (connect, form, frame, object, worker and base are all shut).
export const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'self'",
  "style-src 'unsafe-inline' 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

const PERMISSIONS_POLICY = [
  'camera',
  'microphone',
  'geolocation',
  'clipboard-read',
  'clipboard-write',
  'usb',
  'serial',
  'hid',
  'payment',
  'fullscreen',
]
  .map((feature) => `${feature}=()`)
  .join(', ');

export const pageHeaders = (contentType: string): Readonly<Record<string, string>> => ({
  'Content-Type': contentType,
  'Content-Security-Policy': PAGE_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': PERMISSIONS_POLICY,
});
