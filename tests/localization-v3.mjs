import assert from 'node:assert/strict';
import test from 'node:test';
import { sheetText, sheetTranslator, sheetLabel, sheetMessageKeys, remainingChoices } from '../web/sheet-catalogs.js';

test('English and Czech messages preserve the same substitution parameters', () => {
  const placeholders = value => [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]).sort();
  for (const key of sheetMessageKeys) {
    assert.ok(sheetText('cs', key).trim(), key);
    assert.deepEqual(placeholders(sheetText('cs', key)), placeholders(sheetText('en', key)), key);
  }
});

test('substitution preserves authored names verbatim and does not recursively translate content', () => {
  const name = 'River <script> $& {count}';
  assert.equal(sheetText('cs', 'equipment.select', { name }), `Vybrat: ${name}`);
  assert.equal(sheetLabel('cs', 'River pack'), 'River pack');
  assert.equal(sheetLabel('cs', 'toString'), 'toString');
  assert.equal(sheetLabel('cs', 'sleight of hand'), 'Čachry');
  assert.equal(sheetLabel('en', 'sleight of hand'), 'Sleight Of Hand');
  assert.equal(sheetText('unsupported', 'play.hp'), 'Hit points');
});

test('remaining choices uses Czech one/few/other phrases and preserves English plurals', () => {
  const cs = sheetTranslator('cs'), en = sheetTranslator('en');
  assert.equal(remainingChoices(cs, 1), 'Zbývá 1 volba');
  assert.equal(remainingChoices(cs, 3), 'Zbývají 3 volby');
  assert.equal(remainingChoices(cs, 5), 'Zbývá 5 voleb');
  assert.equal(remainingChoices(cs, 0), 'Zbývá 0 voleb');
  assert.equal(remainingChoices(en, 1), '1 choice remaining');
  assert.equal(remainingChoices(en, 3), '3 choices remaining');
});
