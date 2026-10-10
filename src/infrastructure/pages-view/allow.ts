// The navigation and request allow-lists the view host enforces. Both are default-deny: a URL is
// allowed only when it parses as a page URL (or, for requests, is an inline image/font/media load).
import { parsePageUrl } from './page-url';

const INLINE_TYPES: ReadonlySet<string> = new Set(['image', 'font', 'media']);

/** A page may move only within itself: the same page id, any version, any file. */
export const isAllowedNavigation = (currentPageId: string, url: string): boolean => {
  const parsed = parsePageUrl(url);
  return parsed !== undefined && parsed.pageId === currentPageId.toUpperCase();
};

export interface RequestContext {
  /** Electron's resource type for the request, when known. */
  readonly resourceType?: string;
  /** The page being shown; when named, page URLs of any other page are refused. */
  readonly pageId?: string;
}

/** The network filter's question. Anything but a parseable page URL or an inline data/blob
 *  image, font or media load is cancelled before it reaches a socket. */
export const isAllowedRequest = (url: string, context: RequestContext = {}): boolean => {
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return context.resourceType === undefined || INLINE_TYPES.has(context.resourceType);
  }
  const parsed = parsePageUrl(url);
  if (parsed === undefined) return false;
  return context.pageId === undefined || parsed.pageId === context.pageId.toUpperCase();
};
