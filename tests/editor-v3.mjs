import test from 'node:test';
import assert from 'node:assert/strict';
import { SheetEditor } from '../web/sheet-editor.js';
import { SheetRepository } from '../web/sheet-repository.js';
import { blankSheet } from '../web/sheet-state.js';

function fixture(put) {
  const repository = new SheetRepository({ put, get: async () => assert.fail('failed writes must not reload') }, new AbortController().signal);
  return new SheetEditor(repository, { key: 'hero', revision: 3, state: blankSheet() }, () => {});
}
const receipt = revision => ({ results: [{ dataId: 'dnd-sheets', key: 'hero', afterRevision: revision }] });
test('rapid edits preserve the draft and serialize against acknowledged revisions', async () => {
  const started = Promise.withResolvers(), blocked = Promise.withResolvers(), writes = [];
  const editor = fixture(async (key, value, revision) => {
    writes.push({ key, value, revision });
    if (writes.length === 1) { started.resolve(); await blocked.promise; }
    return receipt(revision + 1);
  });
  const first = editor.change(draft => { draft.hp = 7; });
  await started.promise;
  const second = editor.change(draft => { draft.notes = 'Keep both changes'; });
  assert.equal(editor.snapshot.state.hp, 7); assert.equal(editor.dirty, true); assert.equal(editor.saving, true);
  blocked.resolve(); assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(writes.map(write => write.revision), [3, 4]);
  assert.equal(writes[1].value.hp, 7); assert.equal(writes[1].value.notes, 'Keep both changes');
  assert.equal(editor.dirty, false); assert.equal(editor.snapshot.revision, 5);
});
test('failed saves retain edits, accept further local work and retry explicitly', async () => {
  let fail = true, count = 0;
  const editor = fixture(async () => { count++; if (fail) throw new Error('offline'); return receipt(4); });
  assert.equal(await editor.change(draft => { draft.notes = 'Keep this'; }), false);
  assert.equal(await editor.change(draft => { draft.currency.gp = 25; }), false);
  assert.equal(count, 1); assert.equal(editor.dirty, true);
  fail = false; assert.equal(await editor.save(), true);
  assert.equal(editor.snapshot.state.notes, 'Keep this'); assert.equal(editor.snapshot.state.currency.gp, 25); assert.equal(editor.dirty, false);
});
test('conflicts preserve the entire local draft without advancing the revision', async () => {
  const editor = fixture(async () => { throw Object.assign(new Error('conflict'), { status: 409 }); });
  await editor.change(draft => { draft.notes = 'Unsent work'; draft.homebrew = { secretDoor: true }; });
  assert.equal(editor.snapshot.revision, 3); assert.equal(editor.snapshot.state.notes, 'Unsent work'); assert.equal(editor.error.status, 409);
  assert.deepEqual(editor.snapshot.state.homebrew, { secretDoor: true });
});
test('disposed mounts ignore late acknowledgements and do not send queued drafts', async () => {
  const started = Promise.withResolvers(), blocked = Promise.withResolvers(); let count = 0;
  const editor = fixture(async () => { count++; started.resolve(); await blocked.promise; return receipt(4); });
  const pending = editor.change(draft => { draft.hp = 3; }); await started.promise;
  void editor.change(draft => { draft.hp = 4; }); editor.dispose(); blocked.resolve();
  assert.equal(await pending, false); assert.equal(count, 1); assert.equal(editor.snapshot.revision, 3);
});
