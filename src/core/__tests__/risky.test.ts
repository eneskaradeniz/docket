import { describe, expect, it } from 'vitest';
import { isRiskyPermission } from '../risky';

// WO-0031c — the "Riskli hariç" rule set (operator decisions): CI/agent config, lockfiles, sensitive
// files (.env*/keys/certs/credentials/secrets), and destructive shell. Everything else auto-approves.
const write = (file_path: string): boolean => isRiskyPermission('Write', { file_path });
const edit = (file_path: string): boolean => isRiskyPermission('Edit', { file_path });
const bash = (command: string): boolean => isRiskyPermission('Bash', { command });

describe('isRiskyPermission — file writes', () => {
  it('CI workflows are risky (the mockup example: check.yml)', () => {
    expect(write('.github/workflows/check.yml')).toBe(true);
    expect(write('.github/workflows/deploy.yaml')).toBe(true);
    expect(edit('.github/actions/setup/action.yml')).toBe(true);
    expect(write('repo/.github/workflows/ci.yml')).toBe(true); // nested repo path
    expect(write('src/github/workflows/x.yml')).toBe(false); // not THE .github dir
  });

  it('lockfiles are risky (dependency graphs shift under collaborators)', () => {
    expect(write('package-lock.json')).toBe(true);
    expect(write('yarn.lock')).toBe(true);
    expect(write('pnpm-lock.yaml')).toBe(true);
    expect(write('Cargo.lock')).toBe(true);
    expect(write('poetry.lock')).toBe(true);
    expect(write('composer.lock')).toBe(true);
    expect(write('Gemfile.lock')).toBe(true);
    expect(write('go.sum')).toBe(true);
    expect(write('sub/package-lock.json')).toBe(true); // basename match anywhere in the tree
  });

  it('agent configuration is risky (prompt/hook surfaces — injection risk)', () => {
    expect(write('CLAUDE.md')).toBe(true);
    expect(write('docs/CLAUDE.md')).toBe(true); // basename match
    expect(write('.claude/settings.json')).toBe(true);
    expect(write('.claude/skills/x/SKILL.md')).toBe(true);
  });

  it('sensitive files are risky (operator addition: secrets and key material)', () => {
    expect(write('.env')).toBe(true);
    expect(write('.env.local')).toBe(true);
    expect(write('.env.production')).toBe(true);
    expect(write('server.pem')).toBe(true);
    expect(write('certs/id_key')).toBe(true);
    expect(write('credentials.json')).toBe(true);
    expect(write('config/secrets.yaml')).toBe(true);
    expect(write('.env.example')).toBe(true); // the template too — cheap to ask, painful to leak
  });

  it('ordinary source writes are NOT risky', () => {
    expect(write('src/ui/components/detail/DetailStrip.tsx')).toBe(false);
    expect(edit('docs/adr/ADR-0007-localisation-and-theming.md')).toBe(false);
    expect(edit('src/env-loader.ts')).toBe(false); // "env" substring, not an .env* basename
    expect(write('src/keyboard.ts')).toBe(false); // "key" substring, not a *key* basename
  });

  it('read-only tools are never risky regardless of path', () => {
    expect(isRiskyPermission('Read', { file_path: '.env' })).toBe(false);
    expect(isRiskyPermission('Grep', { pattern: 'secret' })).toBe(false);
    expect(isRiskyPermission('WebFetch', { url: 'https://x/yarn.lock' })).toBe(false);
  });

  it('an unknown tool with no matching shape is not risky', () => {
    expect(isRiskyPermission('Task', { prompt: 'do things' })).toBe(false);
  });
});

describe('isRiskyPermission — shell commands', () => {
  it('git push and remote changes are risky', () => {
    expect(bash('git push origin main')).toBe(true);
    expect(bash('git push --force')).toBe(true);
    expect(bash('git remote set-url origin git@x:y.git')).toBe(true);
    expect(bash('git status')).toBe(false);
    expect(bash('git log --oneline')).toBe(false);
    expect(bash('git commit -m x')).toBe(false);
  });

  it('dependency installation is risky (arbitrary code execution into the tree)', () => {
    expect(bash('npm install')).toBe(true);
    expect(bash('npm i left-pad')).toBe(true);
    expect(bash('yarn add react')).toBe(true);
    expect(bash('pnpm install')).toBe(true);
    expect(bash('bun add x')).toBe(true);
    expect(bash('cargo add serde')).toBe(true);
    expect(bash('pip install requests')).toBe(true);
    expect(bash('poetry add django')).toBe(true);
    expect(bash('composer require monolog')).toBe(true);
    expect(bash('go get ./...')).toBe(true);
    expect(bash('bundle install')).toBe(true);
    expect(bash('npm run typecheck')).toBe(false);
    expect(bash('npm test')).toBe(false);
  });

  it('destructive removal is risky', () => {
    expect(bash('rm -rf node_modules')).toBe(true);
    expect(bash('rm temp.txt')).toBe(true);
    expect(bash('ls -la')).toBe(false);
    expect(bash('cat package.json')).toBe(false);
  });

  it('commands that merely mention a risky word are not risky', () => {
    expect(bash('echo "npm install docs"')).toBe(true); // errs risky — an echo of install is acceptable to over-ask
    expect(bash('grep -r "yarn.lock" docs')).toBe(false);
  });
});
