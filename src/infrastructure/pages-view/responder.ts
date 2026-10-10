// The docket-page handler minus Electron: one request in, one fully-formed answer out. It reads
// only through the application ports and answers every miss identically — the body never says
// what was asked for, which page or version exists, or why a file was refused.
import type { PageFiles, PageRepo } from '../../application/index';

import { pageHeaders } from './headers';
import { pageUrlQuery, parsePageUrl } from './page-url';
import { contentTypeFor, resolveFile } from './resolve';

export interface PageRequest {
  readonly method: string;
  readonly url: string;
}

export interface PageAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

/** What the test hook sees per answered request. `report` is the query of a `__report` load. */
export interface PageServed {
  readonly url: string;
  readonly status: number;
  readonly report?: string;
}

export interface PageResponderDeps {
  readonly pages: Pick<PageRepo, 'get'>;
  readonly files: Pick<PageFiles, 'read'>;
  /** Present only in test launches (the dev bridge's flag): observes every answer and turns a
   *  `/v<n>/__report` load of an existing version into a recorded 204. Absent, `__report` is an
   *  ordinary path like any other. */
  readonly onServed?: (event: PageServed) => void;
}

export interface PageResponder {
  respond(request: PageRequest): Promise<PageAnswer>;
}

const REPORT_PATH = '__report';
const TEXT = 'text/plain; charset=utf-8';
const encoder = new TextEncoder();

// One fixed body per status: identical for every miss, so no answer is an existence oracle.
const failure = (status: number, text: string): PageAnswer => ({
  status,
  headers: pageHeaders(TEXT),
  body: encoder.encode(text),
});
const BAD_REQUEST = (): PageAnswer => failure(400, 'Bad request');
const NOT_FOUND = (): PageAnswer => failure(404, 'Not found');
const NOT_ALLOWED = (): PageAnswer => failure(405, 'Method not allowed');
const UNSUPPORTED = (): PageAnswer => failure(415, 'Unsupported media type');
const INTERNAL = (): PageAnswer => failure(500, 'Internal error');

export const createPageResponder = (deps: PageResponderDeps): PageResponder => {
  const answer = async (request: PageRequest): Promise<{ readonly answer: PageAnswer; readonly report?: string }> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return { answer: NOT_ALLOWED() };
    const parsed = parsePageUrl(request.url);
    if (parsed === undefined) return { answer: BAD_REQUEST() };

    const page = await deps.pages.get(parsed.pageId);
    const version = page?.versions.find((candidate) => candidate.n === parsed.version);
    if (version === undefined) return { answer: NOT_FOUND() };

    if (deps.onServed !== undefined && parsed.path === REPORT_PATH) {
      const report = pageUrlQuery(request.url) ?? '';
      return { answer: { status: 204, headers: pageHeaders(TEXT), body: new Uint8Array(0) }, report };
    }

    const path = resolveFile(version, parsed.path);
    if (path === undefined) return { answer: NOT_FOUND() };
    const contentType = contentTypeFor(path);
    if (contentType === undefined) return { answer: UNSUPPORTED() };
    const bytes = await deps.files.read(parsed.pageId, parsed.version, path);
    if (bytes === undefined) return { answer: NOT_FOUND() };
    return {
      answer: { status: 200, headers: pageHeaders(contentType), body: request.method === 'HEAD' ? new Uint8Array(0) : bytes },
    };
  };

  return {
    respond: async (request) => {
      let result: { readonly answer: PageAnswer; readonly report?: string };
      try {
        result = await answer(request);
      } catch {
        // A storage failure is an internal error; its message (it may name a path) never travels.
        result = { answer: INTERNAL() };
      }
      deps.onServed?.({
        url: request.url,
        status: result.answer.status,
        ...(result.report === undefined ? {} : { report: result.report }),
      });
      return result.answer;
    },
  };
};
