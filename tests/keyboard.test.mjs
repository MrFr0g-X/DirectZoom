import test from 'node:test';
import assert from 'node:assert/strict';
import { shortcutsFromKeys } from '../src/keyboard.ts';

const key = (t, event, name, code, isModifier) => ({ t, event, key: name, keyCode: code, isModifier, modifiers: { alt: false, ctrl: false, meta: false, shift: false } });

test('modifier + key becomes a shortcut; plain typing does not', () => {
  const events = [
    key(1000, 'down', 'Ctrl', 162, true), key(1100, 'down', 'Shift', 160, true), key(1200, 'down', 'R', 82, false),
    key(1300, 'up', 'R', 82, false), key(1320, 'up', 'Shift', 160, true), key(1340, 'up', 'Ctrl', 162, true),
    key(3000, 'down', 'H', 72, false), key(3050, 'up', 'H', 72, false), key(3100, 'down', 'I', 73, false), key(3150, 'up', 'I', 73, false),
  ];
  const withSymbols = shortcutsFromKeys(events, 150, true);
  assert.equal(withSymbols.length, 1);
  assert.deepEqual(withSymbols[0].keys, ['Ctrl', 'Shift', 'R']);
  assert.equal(withSymbols[0].displayText, '^⇧R');
  assert.equal(shortcutsFromKeys(events, 150, false)[0].displayText, 'Ctrl + Shift + R');
});
