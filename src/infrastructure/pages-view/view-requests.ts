// What the renderer may ask of the page view, and who may ask. Decisions live here so the
// Electron-touching host stays a thin executor.
import type { PageId } from '../../domain/index';
import { isUlid } from '../../domain/index';

export interface ViewBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type PageViewRequest =
  | { readonly op: 'open'; readonly pageId: PageId; readonly version: number; readonly bounds: ViewBounds }
  | { readonly op: 'setBounds'; readonly bounds: ViewBounds }
  | { readonly op: 'close' };

const MAX_VERSION = 999_999_999;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Own properties only: an inherited `op` or coordinate on a prototype is not input. */
const own = (record: Record<string, unknown>, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

const coordinate = (value: unknown, minimum: number): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && !Object.is(value, -0) ? value : undefined;

const parseBounds = (value: unknown): ViewBounds | undefined => {
  if (!isRecord(value)) return undefined;
  const x = coordinate(own(value, 'x'), 0);
  const y = coordinate(own(value, 'y'), 0);
  const width = coordinate(own(value, 'width'), 1);
  const height = coordinate(own(value, 'height'), 1);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return { x, y, width, height };
};

/** Validates and re-builds the request: unknown fields are dropped, never forwarded. */
export const parsePageViewRequest = (value: unknown): PageViewRequest | undefined => {
  if (!isRecord(value)) return undefined;
  const op = own(value, 'op');
  if (op === 'close') return { op: 'close' };
  const bounds = parseBounds(own(value, 'bounds'));
  if (bounds === undefined) return undefined;
  if (op === 'setBounds') return { op: 'setBounds', bounds };
  if (op !== 'open') return undefined;
  const pageId = own(value, 'pageId');
  const version = own(value, 'version');
  if (typeof pageId !== 'string' || !isUlid(pageId.toUpperCase()) || !/^[0-9A-Za-z]{26}$/.test(pageId)) return undefined;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || version > MAX_VERSION) return undefined;
  return { op: 'open', pageId: pageId.toUpperCase() as PageId, version, bounds };
};

const isPositiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 1;

/** Fits the requested bounds into the window's content area: the origin is pulled to the last
 *  pixel at most, the size is cut at the edge, and the view keeps at least one pixel. */
export const clampBounds = (bounds: ViewBounds, content: { readonly width: number; readonly height: number }): ViewBounds | undefined => {
  if (!isPositiveInteger(content.width) || !isPositiveInteger(content.height)) return undefined;
  const x = Math.min(bounds.x, content.width - 1);
  const y = Math.min(bounds.y, content.height - 1);
  return {
    x,
    y,
    width: Math.max(1, Math.min(bounds.width, content.width - x)),
    height: Math.max(1, Math.min(bounds.height, content.height - y)),
  };
};

export interface PageViewCaller {
  readonly webContentsId: number;
  /** Whether the call came from the web contents' own top frame. */
  readonly isMainFrame: boolean;
}

/** Only the top frame of the app's main window drives the page view. */
export const isTrustedPageViewCaller = (caller: PageViewCaller | undefined, mainWebContentsId: number | undefined): boolean =>
  caller !== undefined &&
  mainWebContentsId !== undefined &&
  Number.isSafeInteger(mainWebContentsId) &&
  caller.isMainFrame &&
  caller.webContentsId === mainWebContentsId;
