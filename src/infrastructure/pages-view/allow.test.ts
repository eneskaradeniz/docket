// I-67 — navigation and request allow-lists.
import { describe, expect, it } from 'vitest';

import { isAllowedNavigation, isAllowedRequest } from './allow';

const ID = '01JZ8K3M4N5P6Q7R8S9T0V1W2X';
const OTHER = '01JZ8K3M4N5P6Q7R8S9T0V1W2Y';

describe('I-67: isAllowedNavigation', () => {
  it('I-67: the same page, any version, any file', () => {
    expect(isAllowedNavigation(ID, `docket-page://${ID}/v1/`)).toBe(true);
    expect(isAllowedNavigation(ID, `docket-page://${ID}/v7/a/b.html?x#y`)).toBe(true);
    expect(isAllowedNavigation(ID, `docket-page://${ID.toLowerCase()}/v2/`)).toBe(true);
  });

  it.each([
    ['another page', `docket-page://${OTHER}/v1/`],
    ['http', `http://${ID}/v1/`],
    ['https', 'https://example.com/'],
    ['file', 'file:///etc/hosts'],
    ['data', 'data:text/html,hi'],
    ['about', 'about:blank'],
    ['javascript', 'javascript:alert(1)'],
    ['blob', 'blob:docket-page://x/1'],
    ['the app scheme', 'app://index.html'],
    ['devtools', 'devtools://devtools/bundled/inspector.html'],
    ['unparseable page url', `docket-page://${ID}/v1/../v1/x`],
    ['userinfo smuggling', `docket-page://${OTHER}@${ID}/v1/`],
    ['empty', ''],
  ])('I-67: refuses %s', (_label, url) => {
    expect(isAllowedNavigation(ID, url)).toBe(false);
  });

  it('I-67: an invalid current page id allows nothing', () => {
    expect(isAllowedNavigation('', `docket-page://${ID}/v1/`)).toBe(false);
    expect(isAllowedNavigation('nope', `docket-page://${ID}/v1/`)).toBe(false);
  });
});

describe('I-67: isAllowedRequest', () => {
  it('I-67: a parseable page url', () => {
    expect(isAllowedRequest(`docket-page://${ID}/v1/app.js`)).toBe(true);
    expect(isAllowedRequest(`docket-page://${ID}/v1/__report?a=b`)).toBe(true);
  });

  it('I-67: data and blob loads for image, font and media', () => {
    for (const resourceType of ['image', 'font', 'media']) {
      expect(isAllowedRequest('data:image/png;base64,AAAA', { resourceType })).toBe(true);
      expect(isAllowedRequest('blob:docket-page://abc/123', { resourceType })).toBe(true);
    }
    expect(isAllowedRequest('data:image/png;base64,AAAA')).toBe(true);
  });

  it('I-67: data and blob are refused for every other resource type', () => {
    for (const resourceType of ['mainFrame', 'subFrame', 'script', 'stylesheet', 'xhr', 'webSocket', 'ping', 'object', 'worker', 'other']) {
      expect(isAllowedRequest('data:text/html,hi', { resourceType })).toBe(false);
      expect(isAllowedRequest('blob:docket-page://abc/123', { resourceType })).toBe(false);
    }
  });

  it('I-67: a page url of another page is refused when the current page is named', () => {
    expect(isAllowedRequest(`docket-page://${OTHER}/v1/a.png`, { pageId: ID })).toBe(false);
    expect(isAllowedRequest(`docket-page://${ID}/v1/a.png`, { pageId: ID })).toBe(true);
  });

  it.each([
    ['http', 'http://127.0.0.1:9/probe'],
    ['https', 'https://example.com/'],
    ['ws', 'ws://127.0.0.1:9/'],
    ['wss', 'wss://example.com/'],
    ['file', 'file:///etc/hosts'],
    ['ftp', 'ftp://example.com/'],
    ['about', 'about:blank'],
    ['javascript', 'javascript:1'],
    ['filesystem', 'filesystem:docket-page://x/temporary/a'],
    ['chrome-extension', 'chrome-extension://abc/a.js'],
    ['devtools', 'devtools://devtools/x'],
    ['unparseable page url', `docket-page://${ID}/v1/%2e%2e%2fx`],
    ['userinfo page url', `docket-page://${ID}@evil.example/v1/a`],
    ['mixed-case scheme', `Docket-Page://${ID}/v1/a`],
    ['empty', ''],
  ])('I-67: refuses %s', (_label, url) => {
    expect(isAllowedRequest(url)).toBe(false);
  });
});
