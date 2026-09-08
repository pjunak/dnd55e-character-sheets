import test from 'node:test';
import assert from 'node:assert/strict';
import { equipmentCandidates, equipmentSlot, equipInventory, inventoryRecord } from '../web/equipment-state.js';
import { blankSheet } from '../web/sheet-state.js';

const catalog = [
  { id: 'leather', kind: 'armor', name: 'Leather', armorType: 'light' },
  { id: 'mail', kind: 'armor', name: 'Mail', armorType: 'heavy' },
  { id: 'shield', kind: 'armor', name: 'Shield', armorType: 'shield' },
  { id: 'ring', kind: 'magic-item', name: 'Ring', attunement: true },
  { id: 'potion', kind: 'magic-item', name: 'Potion', attunement: false },
];
const item = (ref, location = 'pack') => ({ id: ref, name: ref, kind: catalog.find(row => row.id === ref)?.kind, ref, qty: 1, location, notes: 'Retain engraving' });

test('worn slots replace one armor piece while retaining a shield and authored fields', () => {
  const state = blankSheet(); state.inventory = [item('leather', 'equipped'), item('shield', 'equipped'), item('mail'), item('ring'), item('potion')];
  assert.deepEqual(equipmentCandidates(state, 'armor', catalog).map(row => row.id), ['mail']);
  equipInventory(state, 'mail', 'armor', catalog);
  assert.equal(state.inventory[0].location, 'pack'); assert.equal(state.inventory[1].location, 'equipped');
  assert.equal(state.inventory[2].location, 'equipped'); assert.equal(state.inventory[2].notes, 'Retain engraving');
  assert.equal(equipmentSlot(state.inventory[2], []), 'armor');
  const before = structuredClone(state);
  equipInventory(state, 'ring', 'shield', catalog); assert.deepEqual(state, before);
  assert.deepEqual(equipmentCandidates(state, 'attuned', catalog).map(row => row.id), ['ring']);
  equipInventory(state, 'ring', 'attuned', catalog);
  assert.equal(state.inventory[3].attuned, true); assert.equal(state.inventory[3].location, 'pack');
  assert.equal(equipmentSlot(state.inventory[3], catalog), 'attuned');
  assert.deepEqual(equipmentCandidates(state, 'attuned', catalog), []);
});

test('equipment keeps standalone snapshots and never guesses between ambiguous names', () => {
  const old = { ...item('legacy'), name: 'Leather', snapshot: { armorType: 'light' } };
  assert.equal(equipmentSlot(old, []), 'armor');
  assert.deepEqual(inventoryRecord({ ...old, snapshot: undefined }, [...catalog, { ...catalog[0], id: 'other' }]), {});
  const state = blankSheet(); state.inventory = [old, { ...item('ring'), qty: 0 }, { ...item('potion'), name: 'Custom trinket', ref: 'custom' }];
  assert.deepEqual(equipmentCandidates(state, 'attuned', [] ).map(row => row.id), ['potion']);
  equipInventory(state, 'legacy', 'armor', []); assert.equal(state.inventory[0].location, 'equipped');
});
