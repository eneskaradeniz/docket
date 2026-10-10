// I-64 / I-65 / I-66 at the response level — the responder is the whole docket-page handler minus
// Electron: it parses, looks the page and version up through the ports, resolves the file by exact
// match and answers every outcome with the full header set and a body that never echoes the request.
import { describe, expect, it } from 'vitest';

import type { Page, PageId, PageVersion } from '../../domain/index';
import type { PageFiles, PageRepo } from '../../application/index';

import { pageHeaders } from './headers';
import { createPageResponder } from './responder';
import type { PageServed } from './responder';

const ID = '01JZ8K3M4N5P6Q7R8S9T0V1W2X' as PageId;
const base = `docket-page://${ID.toLowerCase()}`;
const actor = { kind: 'user', id: 'u', label: 'U' } as const;

const ref = (path: string) => ({ path, bytes: 1, sha256: 'x' });
const v1: PageVersion = {
  n: 1,
  createdAt: 1 as PageVersion['createdAt'],
  by: actor,
  entry: 'index.html',
  files: [ref('index.html'), ref('app.js'), ref('data.bin'), ref('__report'), ref('ghost.css')],
};
const page: Page = {
  id: ID,
  title: 't',
  kind: 'html',
  createdBy: actor,
  createdAt: 1 as Page['createdAt'],
  versions: [v1],
  approval: 'none',
};

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const stored = new Map<string, Uint8Array>([
  [`${ID}/1/index.html`, bytesOf('<h1>hi</h1>')],
  [`${ID}/1/app.js`, bytesOf('1')],
  [`${ID}/1/data.bin`, bytesOf('x')],
  // On disk and in the version directory, but never recorded: must stay unreachable.
  [`${ID}/1/secret`, bytesOf('TOP SECRET')],
]);

const pages = { get: async (id: PageId) => (id === ID ? page : undefined) } as Pick<PageRepo, 'get'>;
const files = {
  read: async (id: PageId, n: number, path: string) => stored.get(`${id}/${n}/${path}`),
} as Pick<PageFiles, 'read'>;

const responder = (extra: { onServed?: (event: PageServed) => void; failing?: boolean } = {}) =>
  createPageResponder({
    pages: extra.failing === true ? { get: async () => { throw new Error('/etc/passwd leaked'); } } : pages,
    files,
    ...(extra.onServed === undefined ? {} : { onServed: extra.onServed }),
  });

const text = (body: Uint8Array): string => new TextDecoder().decode(body);

describe('I-64: the responder serves recorded files only', () => {
  it('I-64: a recorded file answers 200 with its bytes and content type', async () => {
    const answer = await responder().respond({ method: 'GET', url: `${base}/v1/index.html` });
    expect(answer.status).toBe(200);
    expect(text(answer.body)).toBe('<h1>hi</h1>');
    expect(answer.headers['Content-Type']).toBe('text/html; charset=utf-8');
  });

  it('I-64: /v1/ answers the entry', async () => {
    const answer = await responder().respond({ method: 'GET', url: `${base}/v1/` });
    expect(answer.status).toBe(200);
    expect(text(answer.body)).toBe('<h1>hi</h1>');
  });

  it('I-64: HEAD answers the headers and no body', async () => {
    const answer = await responder().respond({ method: 'HEAD', url: `${base}/v1/index.html` });
    expect(answer.status).toBe(200);
    expect(answer.body.length).toBe(0);
    expect(answer.headers['Content-Type']).toBe('text/html; charset=utf-8');
  });

  it('I-64: a file on disk that the version never recorded is a 404, however it is spelled', async () => {
    for (const url of [
      `${base}/v1/secret`,
      `${base}/v1/%73ecret`,
      `${base}/v1/SECRET`,
      `${base}/v1/../v1/secret`,
      `${base}/v1/%2e%2e%2fv1%2fsecret`,
      `${base}/v1/secret?index.html`,
    ]) {
      const answer = await responder().respond({ method: 'GET', url });
      expect([400, 404], url).toContain(answer.status);
      expect(text(answer.body)).not.toContain('SECRET');
    }
    expect((await responder().respond({ method: 'GET', url: `${base}/v1/secret` })).status).toBe(404);
  });

  it('I-64: a recorded file whose bytes are gone from disk is a 404', async () => {
    expect((await responder().respond({ method: 'GET', url: `${base}/v1/ghost.css` })).status).toBe(404);
  });

  it('I-64: an unknown page, an unknown version and a miss answer the same status, headers and body', async () => {
    const answers = await Promise.all(
      [
        `docket-page://01JZ8K3M4N5P6Q7R8S9T0V1W2Y/v1/index.html`,
        `${base}/v2/index.html`,
        `${base}/v1/nope.html`,
        `${base}/v1/secret`,
        `${base}/v1/very/deep/missing/file.txt`,
      ].map((url) => responder().respond({ method: 'GET', url })),
    );
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(answer.headers).toEqual(answers[0]?.headers);
      expect(text(answer.body)).toBe(text(answers[0]?.body ?? new Uint8Array()));
    }
  });

  it('I-64: no response body ever echoes the requested path, page id or file name', async () => {
    const urls = [`${base}/v1/nope-marker.html`, `${base}/v9/index.html`, `${base}/v1/..%2fecho-marker`, `${base}/v1/data.bin`];
    for (const url of urls) {
      const answer = await responder().respond({ method: 'POST', url });
      const answers = [answer, await responder().respond({ method: 'GET', url })];
      for (const each of answers) {
        for (const marker of ['marker', ID, ID.toLowerCase(), 'nope', 'index.html']) {
          expect(text(each.body)).not.toContain(marker);
        }
      }
    }
  });
});

describe('I-65: the responder refuses an unknown content type with 415', () => {
  it('I-65: a recorded file with an unknown extension is 415', async () => {
    const answer = await responder().respond({ method: 'GET', url: `${base}/v1/data.bin` });
    expect(answer.status).toBe(415);
    expect(answer.body.length === 0 || !text(answer.body).includes('x')).toBe(true);
  });

  it('I-65: an unrecorded file with an unknown extension is still a 404, not a 415 (no existence oracle)', async () => {
    expect((await responder().respond({ method: 'GET', url: `${base}/v1/other.bin` })).status).toBe(404);
  });
});

describe('I-66: every response carries the full header set', () => {
  it('I-66: 200, 400, 404, 405, 415 and 500 all carry the page headers', async () => {
    const cases: readonly (readonly [string, string, number, boolean?])[] = [
      ['GET', `${base}/v1/index.html`, 200],
      ['GET', `${base}/v1/..`, 400],
      ['GET', 'docket-page://nope/v1/', 400],
      ['GET', `${base}/v1/nope.html`, 404],
      ['POST', `${base}/v1/index.html`, 405],
      ['DELETE', `${base}/v1/index.html`, 405],
      ['GET', `${base}/v1/data.bin`, 415],
      ['GET', `${base}/v1/index.html`, 500, true],
    ];
    for (const [method, url, status, failing] of cases) {
      const answer = await responder({ failing: failing === true }).respond({ method, url });
      expect(answer.status, `${method} ${url}`).toBe(status);
      const contentType = answer.headers['Content-Type'] ?? '';
      expect(answer.headers).toEqual(pageHeaders(contentType));
    }
  });

  it('I-66: an error never says why, and a thrown port error never travels', async () => {
    const answer = await responder({ failing: true }).respond({ method: 'GET', url: `${base}/v1/index.html` });
    expect(answer.status).toBe(500);
    expect(text(answer.body)).not.toContain('passwd');
  });

  it('I-66: 405 is for every method that is not GET or HEAD, whatever its case', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT', 'get', '']) {
      expect((await responder().respond({ method, url: `${base}/v1/index.html` })).status, method).toBe(405);
    }
  });
});

describe('I-66: the served hook (test launches only)', () => {
  it('I-66: reports every answered request and records a __report load as 204 only while the hook exists', async () => {
    const seen: PageServed[] = [];
    const hooked = responder({ onServed: (event) => seen.push(event) });
    const report = await hooked.respond({ method: 'GET', url: `${base}/v1/__report?a=1&b=2` });
    expect(report.status).toBe(204);
    await hooked.respond({ method: 'GET', url: `${base}/v1/secret` });
    expect(seen).toEqual([
      { url: `${base}/v1/__report?a=1&b=2`, status: 204, report: 'a=1&b=2' },
      { url: `${base}/v1/secret`, status: 404 },
    ]);
    // Without the hook the same URL is an ordinary recorded file (here: no type for it, so 415).
    const plain = await responder().respond({ method: 'GET', url: `${base}/v1/__report?a=1` });
    expect(plain.status).toBe(415);
  });

  it('I-66: the hook answers 404 for a report to an unknown page or version', async () => {
    const hooked = responder({ onServed: () => undefined });
    expect((await hooked.respond({ method: 'GET', url: `${base}/v5/__report?a=1` })).status).toBe(404);
  });
});
