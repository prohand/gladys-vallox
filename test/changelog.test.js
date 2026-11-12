import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-vallox';

test('the Unreleased section becomes the release section', () => {
  const before = [
    '# Changelog',
    '',
    'Changes go under `## [Unreleased]`.',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '- Something new.',
    '',
    '## [1.0.0] - 2026-11-12',
    '',
    '- First release.',
    '',
    `[Unreleased]: ${REPO}/compare/v1.0.0...HEAD`,
    `[1.0.0]: ${REPO}/releases/tag/v1.0.0`,
    '',
  ].join('\n');
  const after = rollChangelog(before, '1.1.0', '2026-12-01');
  assert.match(
    after,
    /## \[Unreleased\]\n\n## \[1\.1\.0\] - 2026-12-01\n\n### Added\n\n- Something new\./,
  );
  assert.match(after, /\[Unreleased\]: .*\/compare\/v1\.1\.0\.\.\.HEAD/);
  assert.match(after, /\[1\.1\.0\]: .*\/compare\/v1\.0\.0\.\.\.v1\.1\.0/);
  // Idempotent: the same version is never written twice.
  assert.equal(rollChangelog(after, '1.1.0', '2026-12-02'), after);
});

test('an empty Unreleased section still names the release', () => {
  const after = rollChangelog(
    `## [Unreleased]\n\n[Unreleased]: ${REPO}/commits/main\n`,
    '1.0.1',
    '2026-12-01',
  );
  assert.match(after, /## \[1\.0\.1\] - 2026-12-01\n\n- Maintenance release/);
  assert.match(after, /\[1\.0\.1\]: .*\/releases\/tag\/v1\.0\.1/);
});
