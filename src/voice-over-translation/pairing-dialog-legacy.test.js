import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('./pairing-dialog.ts', import.meta.url),
  'utf8'
);

test('pairing dialog avoids DOM and string methods missing from Chromium 53', () => {
  assert.doesNotMatch(source, /\.append\s*\(/);
  assert.doesNotMatch(source, /\.replaceChildren\s*\(/);
  assert.doesNotMatch(source, /\.padStart\s*\(/);
});
