import { describe, expect, it } from 'vitest';
import { parseFindings } from '../findings';

describe('parseFindings', () => {
  it('returns [] for no fence', () => {
    expect(parseFindings('Rapor...\n')).toEqual([]);
  });

  it('parses valid bulgular fence', () => {
    const report = `Rapor...
\`\`\`bulgular
[
  {
    "repo": "mobile",
    "path": "src/App.tsx:10",
    "problem": "Missing i18n"
  }
]
\`\`\`
`;
    expect(parseFindings(report)).toEqual([
      { repo: 'mobile', path: 'src/App.tsx:10', problem: 'Missing i18n' }
    ]);
  });

  it('returns [] for bad JSON', () => {
    const report = `\`\`\`bulgular
[ { "repo": "mobile" // bad json
\`\`\`
`;
    expect(parseFindings(report)).toEqual([]);
  });

  it('returns [] if any element is invalid', () => {
    const report = `\`\`\`bulgular
[
  { "repo": "mobile", "path": "src/App.tsx:10", "problem": "Missing i18n" },
  { "repo": "api", "problem": "No path" }
]
\`\`\`
`;
    expect(parseFindings(report)).toEqual([]);
  });

  it('takes the last fence', () => {
    const report = `
\`\`\`bulgular
[ { "repo": "a", "path": "a:1", "problem": "a" } ]
\`\`\`
...
\`\`\`bulgular
[ { "repo": "b", "path": "b:2", "problem": "b" } ]
\`\`\`
`;
    expect(parseFindings(report)).toEqual([
      { repo: 'b', path: 'b:2', problem: 'b' }
    ]);
  });
});
