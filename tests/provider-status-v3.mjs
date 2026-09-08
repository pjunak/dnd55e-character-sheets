import test from 'node:test';
import assert from 'node:assert/strict';
import { RulesEngineClient, connectRulesEngine } from '../web/engine-client.js';
import { savedProviderStatus } from '../web/rules-status.js';
import { sheetText, sheetMessageKeys } from '../web/sheet-catalogs.js';
import { blankSheet } from '../web/sheet-state.js';

const engine = { addonId: 'independent-rules', contractVersion: '3.0.0', generation: 'a'.repeat(64), bindingRevision: 3 };
const identity = { providerAddonId: 'independent-data', providerContractVersion: '3.0.0', providerGeneration: 'b'.repeat(64), contentRevision: 'content-1', rulesetId: 'rules', rulesetVersion: 1, edition: '2024' };
const context = (status = 'ready') => ({ contractVersion: 'rules-engine-context.v1', available: status === 'ready', status, identity: status === 'ready' ? identity : {}, errors: status === 'ready' ? [] : [`Provider reports ${status}`] });

test('provider inspection uses the read-only context contract and preserves the exact engine/data identity', async () => {
  const calls = [], client = new RulesEngineClient({ available: true, providers: [engine], call: async (...args) => { calls.push(args); return context(); } }, new AbortController().signal);
  assert.equal(client.diagnostics.status, 'unchecked');
  const result = await client.inspect(); assert.equal(result.status, 'ready'); assert.deepEqual(result.identity, identity);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'context'); assert.deepEqual(calls[0][1], {}); assert.equal(calls[0][2].deadlineMs, 6000);
  assert.deepEqual(client.providerIdentity, { engineAddonId: engine.addonId, engineContractVersion: engine.contractVersion, engineGeneration: engine.generation, engineBindingRevision: engine.bindingRevision });
  result.identity.contentRevision = 'changed outside'; assert.equal(client.diagnostics.identity.contentRevision, 'content-1');
});

test('inspection distinguishes absent engine, failed discovery and unavailable data without automatic retries', async () => {
  let discovery = 0;
  const host = { signal: new AbortController().signal, services: { connect: async () => { discovery++; return { available: false, providers: [], call: () => assert.fail('absent engine') }; } } };
  const absent = await connectRulesEngine(host); assert.equal((await absent.inspect()).status, 'missing-engine'); assert.equal(discovery, 1);
  host.services.connect = async () => { discovery++; throw new Error('Discovery offline'); };
  const failed = await connectRulesEngine(host); assert.equal((await failed.inspect()).status, 'connection-error'); assert.deepEqual(failed.diagnostics.errors, ['Discovery offline']); assert.equal(discovery, 2);
  for (const status of ['missing', 'unavailable', 'incompatible', 'stale']) {
    const client = new RulesEngineClient({ available: true, providers: [engine], call: async () => context(status) }, host.signal);
    assert.equal((await client.inspect()).status, status); assert.equal(client.diagnostics.identity, undefined);
  }
});

test('stale handles fail visibly and explicit discovery returns a new connection without changing the old one', async () => {
  const stale = Object.assign(new Error('Changed binding'), { code: 'STALE_BINDING' }); let calls = 0;
  const first = new RulesEngineClient({ available: true, providers: [engine], call: async () => { calls++; throw stale; } }, new AbortController().signal);
  await assert.rejects(first.hydrate(blankSheet()), /Changed binding/); assert.equal(first.diagnostics.status, 'stale'); assert.equal(calls, 1);
  const replacement = { ...engine, addonId: 'replacement-engine', bindingRevision: 4 };
  const fresh = await connectRulesEngine({ signal: new AbortController().signal, services: { connect: async (contract, options) => {
    assert.equal(contract, 'dnd5e.rules-engine'); assert.equal(options.range, '^3.0.0'); assert.equal(options.cardinality, 'one');
    return { available: true, providers: [replacement], call: async () => context() };
  } } });
  assert.equal((await fresh.inspect()).status, 'ready'); assert.equal(first.providerIdentity.engineAddonId, engine.addonId); assert.equal(first.diagnostics.status, 'stale');
  assert.equal(fresh.providerIdentity.engineAddonId, replacement.addonId);
});

test('aborted discovery and late inspection cannot resurrect a disposed connection', async () => {
  const controller = new AbortController(); let finish;
  const client = new RulesEngineClient({ available: true, providers: [engine], call: async () => new Promise(resolve => { finish = resolve; }) }, controller.signal);
  const pending = client.inspect(); controller.abort(); finish(context());
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(client.diagnostics.status, 'unchecked');
  await assert.rejects(connectRulesEngine({ signal: controller.signal, services: { connect: () => assert.fail('disposed generation') } }), { name: 'AbortError' });
});

test('builder and hydration responses update provider status while preserving their results', async () => {
  let result = { ...context('missing'), plan: undefined };
  const client = new RulesEngineClient({ available: true, providers: [engine], call: async () => result }, new AbortController().signal);
  assert.equal(await client.builderPlan(blankSheet()), result); assert.equal(client.diagnostics.status, 'missing');
  result = { identity, sheet: {}, warnings: [] }; assert.equal(await client.hydrate(blankSheet()), result); assert.equal(client.diagnostics.status, 'ready');
  result = { sheet: {}, warnings: ['Rules data unavailable'] }; await client.hydrate(blankSheet()); assert.equal(client.diagnostics.status, 'unavailable'); assert.equal(client.diagnostics.identity, undefined);
});

test('saved provenance distinguishes a changed provider from incomplete or unverified source metadata', () => {
  const current = { engineAddonId: 'engine', engineContractVersion: '3.0.0', engineGeneration: 'g1', engineBindingRevision: 1, ...identity };
  assert.equal(savedProviderStatus(current, current), 'same'); assert.equal(savedProviderStatus(current, undefined), 'unverified');
  assert.equal(savedProviderStatus({ edition: '2024' }, current), 'unverified'); assert.equal(savedProviderStatus({}, current), 'none');
  for (const key of ['engineGeneration', 'engineBindingRevision', 'providerGeneration', 'contentRevision', 'rulesetVersion', 'edition']) assert.equal(savedProviderStatus({ ...current, [key]: 'older' }, current), 'changed');
  assert.equal(savedProviderStatus(current, { engineAddonId: 'engine' }), 'unverified');
});

test('invalid choices keep the known provider status while worker failure reports a connection error', async () => {
  let failure;
  const client = new RulesEngineClient({ available: true, providers: [engine], call: async () => { if (failure) throw failure; return context(); } }, new AbortController().signal);
  await client.inspect(); const ready = client.diagnostics;
  failure = Object.assign(new Error('Invalid choice'), { code: 'INVALID_REQUEST' });
  await assert.rejects(client.applyChoice(blankSheet(), { choiceId: 'choice', value: 'invalid' }), /Invalid choice/);
  assert.deepEqual(client.diagnostics, ready);
  failure = Object.assign(new Error('Worker unavailable'), { code: 'SERVICE_UNAVAILABLE' });
  await assert.rejects(client.hydrate(blankSheet()), /Worker unavailable/);
  assert.equal(client.diagnostics.status, 'connection-error'); assert.equal(client.providerIdentity.engineAddonId, engine.addonId);
});

test('English and Czech diagnostics catalogs are complete with an English default', () => {
  for (const key of sheetMessageKeys) { assert.ok(sheetText('en', key)); assert.ok(sheetText('cs', key)); assert.equal(sheetText(undefined, key), sheetText('en', key)); }
  assert.equal(sheetText('cs', 'providers.ready'), 'Pravidla jsou připravena'); assert.equal(sheetText('cs', 'tab.tools'), 'Nastavení');
});
