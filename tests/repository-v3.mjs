import test from "node:test";
import assert from "node:assert/strict";
import { SheetRepository } from "../web/sheet-repository.js";

test("missing extension documents open as revision-zero blank sheets", async () => {
  const handle = { async get() { throw Object.assign(new Error("missing"), { status: 404 }); }, async put() { throw new Error("unexpected"); } };
  const repository = new SheetRepository(handle, new AbortController().signal);
  const snapshot = await repository.load("hero");
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.state.v, 3);
});

test("writes use the loaded revision and acknowledge the new revision", async () => {
  const calls = [];
  const handle = {
    async get() { return { key: "hero", revision: 4, value: { v: 2, hp: 6, maxHp: 10 } }; },
    async put(key, value, revision) {
      calls.push({ key, value, revision });
      return { results: [{ dataId: "dnd-sheets", key, afterRevision: 5 }] };
    },
  };
  const repository = new SheetRepository(handle, new AbortController().signal);
  const loaded = await repository.load("hero");
  const saved = await repository.save(loaded, (draft) => { draft.hp = 7; });
  assert.deepEqual(calls.map(({ key, revision }) => ({ key, revision })), [{ key: "hero", revision: 4 }]);
  assert.equal(calls[0].value.v, 3);
  assert.equal(saved.revision, 5);
  assert.equal(saved.state.hp, 7);
});
