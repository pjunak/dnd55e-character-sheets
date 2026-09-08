import test from "node:test";
import assert from "node:assert/strict";
import { RulesEngineClient, materializeHydration } from "../web/engine-client.js";
import { blankSheet } from "../web/sheet-state.js";

test("engine client sends contract-owned v3 requests", async () => {
  const calls = [];
  const handle = {
    available: true,
    providers: [{ addonId: "dnd-engine", contractVersion: "3.0.0", generation: "a".repeat(64), bindingRevision: 1 }],
    async call(method, params, options) {
      calls.push({ method, params, deadlineMs: options.deadlineMs });
      return method === "builder-plan" ? { available: false, status: "missing", errors: [] } : { records: [] };
    },
  };
  const client = new RulesEngineClient(handle, new AbortController().signal);
  await client.builderPlan(blankSheet());
  assert.equal(calls[0].method, "builder-plan");
  assert.equal(calls[0].params.contractVersion, "rules-engine-builder-plan.v1");
  assert.equal(calls[0].deadlineMs, 15000);
  assert.equal(client.providerLabel, "dnd-engine");
  await client.playChange(blankSheet(), { operation: 'rest', rest: 'long' });
  assert.equal(calls[1].method, 'apply-play-change');
  assert.equal(calls[1].params.contractVersion, 'rules-engine-play-change.v1');
  assert.deepEqual(calls[1].params.change, { operation: 'rest', rest: 'long' });
  assert.equal(calls[1].deadlineMs, 15000);
  await client.spellOptions(blankSheet());
  assert.equal(calls[2].method, 'spell-options');
  assert.equal(calls[2].params.contractVersion, 'rules-engine-spell-options.v1');
  assert.equal(calls[2].params.change, undefined);
  assert.equal(calls[2].deadlineMs, 15000);
});

test("materialization updates durable fallback fields while preserving play state", () => {
  const sheet = blankSheet();
  sheet.hp = 7;
  sheet.inventory.push({ id: "rope", name: "Rope", qty: 1, location: "pack", notes: "" });
  const result = materializeHydration(sheet, {
    identity: { edition: "2024", contentRevision: "r1" },
    warnings: [],
    sheet: {
      totalLevel: 4,
      abilities: { STR: { score: 16 }, DEX: { score: 12 } },
      derived: { maxHp: 36, armorClass: 17, initiative: 1, speed: 30, proficiencyBonus: 2 },
      saves: { STR: { proficient: true } },
      skills: { athletics: { proficient: true, expertise: true } },
    },
  });
  assert.equal(result.level, 4);
  assert.equal(result.maxHp, 36);
  assert.equal(result.hp, 7);
  assert.equal(result.ac, 17);
  assert.equal(result.abilities.STR, 16);
  assert.equal(result.skillExpertise.athletics, true);
  assert.equal(result.inventory[0].name, "Rope");
  assert.equal(result.ruleset, "2024");
  assert.equal(result.baseStats.STR, 10);
});

test("catalog queries unwrap public record envelopes and keep stable identities", async () => {
  let calls = 0;
  const client = new RulesEngineClient({ available: true, providers: [], call: async (_method, params) => {
    calls++;
    if (calls === 1) return { records: [{ id: 'fighter', kind: 'class', value: { name: 'Fighter', hitDie: 'd10' } }], nextCursor: 'next' };
    assert.equal(params.cursor, 'next'); return { records: [{ id: 'wizard', kind: 'class', value: { name: 'Wizard' } }] };
  } }, new AbortController().signal);
  assert.deepEqual(await client.queryAll('class'), [{ id: 'fighter', kind: 'class', name: 'Fighter', hitDie: 'd10' }, { id: 'wizard', kind: 'class', name: 'Wizard' }]);
});

test('materialized play changes honor retained HP and combat overrides', () => {
  const sheet = blankSheet(); sheet.hp = 45; sheet.overrides = { maxHp: 50, ac: 19, initiative: -1, speed: 40 };
  const result = materializeHydration(sheet, { identity: { edition: '2024' }, warnings: [], sheet: { derived: { maxHp: 32, armorClass: 12, initiative: 2, speed: 30 } } });
  assert.equal(result.hp, 45); assert.equal(result.maxHp, 50); assert.equal(result.ac, 19); assert.equal(result.initiative, -1); assert.equal(result.speed, 40);
  assert.deepEqual(result.overrides, sheet.overrides);
});

test("recalculation retains base scores, combat snapshots and authored spell metadata", () => {
  const sheet = blankSheet(); sheet.abilities.INT = 16; sheet.hp = 9;
  sheet.cantrips.wizard = ['light']; sheet.spells = [{ id: 'snapshot:light', name: 'Light', level: 0, school: 'Evocation', prepared: false, origin: 'snapshot', notes: 'My version' }];
  sheet.resourceUses['slot-1'] = 2;
  const hydration = { identity: { edition: '2024' }, warnings: [], sheet: {
    abilities: { INT: { score: 18 } }, derived: { maxHp: 20 }, resources: [{ key: 'slot-1', max: 3 }],
    weapons: [{ name: 'Staff', damage: '1d6+1' }], activations: [{ key: 'ward' }], spellcasting: { perClass: [{ classId: 'wizard' }] },
  } };
  const first = materializeHydration(sheet, hydration), second = materializeHydration(first, hydration);
  assert.equal(second.baseStats.INT, 16); assert.equal(second.abilities.INT, 18);
  assert.equal(second.spells[0].name, 'Light'); assert.equal(second.spells[0].prepared, false); assert.equal(second.spells[0].notes, 'My version');
  assert.equal(second.resourceUses['slot-1'], 2); assert.equal(second.rulesProvider.materialized.weapons[0].name, 'Staff');
  assert.deepEqual(second.rulesProvider.materialized.resources, hydration.sheet.resources);
  assert.throws(() => materializeHydration(sheet, { sheet: {}, warnings: ['Provider missing'] }), /Provider missing/);
});
