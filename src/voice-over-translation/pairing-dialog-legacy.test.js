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

test('pairing dialog CSS has a Chromium 53 centering and spacing fallback', () => {
  assert.doesNotMatch(source, /\binset\s*:/);
  assert.doesNotMatch(source, /\b(?:width|max-width)\s*:\s*min\s*\(/);
  assert.doesNotMatch(source, /\bgap\s*:/);
  assert.match(
    source,
    /position: fixed;[\s\S]*top: 0;[\s\S]*right: 0;[\s\S]*bottom: 0;[\s\S]*left: 0;/
  );
  assert.match(
    source,
    /\.ytaf-vot-pair-card \{[\s\S]*position: fixed;[\s\S]*top: 50%;[\s\S]*left: 50%;[\s\S]*width: 90%;[\s\S]*max-width: 1120px;[\s\S]*transform: translate\(-50%, -50%\);/
  );
  assert.match(
    source,
    /\.ytaf-vot-pair-copy \{[\s\S]*width: calc\(100% - 376px\);[\s\S]*max-width: 644px;[\s\S]*margin-left: 46px;[\s\S]*word-wrap: break-word;/
  );
  assert.match(
    source,
    /\.ytaf-vot-pair-button \+ \.ytaf-vot-pair-button \{[\s\S]*margin-left: 18px;/
  );
});
