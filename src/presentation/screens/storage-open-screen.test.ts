import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { storageOpenCopy } from '../storage-open-error';
import { StorageOpenErrorScreen } from './storage-open-error';

describe('storage open screen (#1168)', () => {
  it('renders labelled paths without JSON for an old-schema boot', () => {
    const copy = storageOpenCopy('tr', {
      kind: 'old_schema',
      dataDir: '/Users/op/.docket',
      dbPath: '/Users/op/.docket/docket.db',
    });
    const html = renderToStaticMarkup(createElement(StorageOpenErrorScreen, { copy }));
    expect(html).toContain('data-storage-open');
    expect(html).toContain('/Users/op/.docket/docket.db');
    expect(html).not.toContain('too_new');
    expect(html).not.toContain('{');
  });
});
