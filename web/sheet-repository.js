import { blankSheet, cloneSheet, normalizeSheet } from "./sheet-state.js";
export class SheetRepository {
    #handle;
    #signal;
    #writeTail = Promise.resolve();
    constructor(handle, signal) {
        this.#handle = handle;
        this.#signal = signal;
    }
    async load(key) {
        this.#signal.throwIfAborted();
        try {
            const document = await this.#handle.get(key, { signal: this.#signal });
            return { key, revision: document.revision, state: normalizeSheet(document.value) };
        }
        catch (error) {
            if (httpStatus(error) === 404)
                return { key, revision: 0, state: blankSheet() };
            throw error;
        }
    }
    save(snapshot, mutate) {
        const operation = this.#writeTail.then(async () => {
            this.#signal.throwIfAborted();
            const draft = cloneSheet(snapshot.state);
            mutate(draft);
            const receipt = await this.#handle.put(snapshot.key, normalizeSheet(draft), snapshot.revision, { signal: this.#signal });
            const result = receipt.results.find((candidate) => candidate.dataId === "dnd-sheets" && candidate.key === snapshot.key);
            if (result === undefined)
                throw new Error("The host did not acknowledge the sheet write.");
            return { key: snapshot.key, revision: result.afterRevision, state: normalizeSheet(draft) };
        });
        this.#writeTail = operation.then(() => undefined, () => undefined);
        return operation;
    }
}
function httpStatus(error) {
    return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;
}
