import { cloneSheet } from "./sheet-state.js";
/** A mount owns its draft. Failed writes never replace it with server data. */
export class SheetEditor {
    repository;
    changed;
    #saved;
    #draft;
    #version = 0;
    #savedVersion = 0;
    #pending;
    #disposed = false;
    error;
    constructor(repository, snapshot, changed) {
        this.repository = repository;
        this.changed = changed;
        this.#saved = snapshot;
        this.#draft = cloneSheet(snapshot.state);
    }
    get snapshot() { return { ...this.#saved, state: this.#draft }; }
    get dirty() { return this.#version !== this.#savedVersion; }
    get saving() { return this.#pending !== undefined; }
    dispose() { this.#disposed = true; }
    change(mutate) {
        if (this.#disposed)
            return Promise.resolve(false);
        const draft = cloneSheet(this.#draft);
        mutate(draft);
        this.#draft = draft;
        this.#version++;
        this.changed();
        // Further edits remain local until an explicit retry after a failed write.
        return this.error === undefined ? this.save() : Promise.resolve(false);
    }
    save() {
        if (this.#disposed)
            return Promise.resolve(false);
        if (this.#pending !== undefined)
            return this.#pending;
        this.error = undefined;
        this.#pending = Promise.resolve().then(async () => {
            while (this.dirty && !this.#disposed) {
                const version = this.#version;
                const state = cloneSheet(this.#draft);
                try {
                    const saved = await this.repository.save(this.#saved, draft => { for (const key of Object.keys(draft))
                        delete draft[key]; Object.assign(draft, state); });
                    if (this.#disposed)
                        return false;
                    this.#saved = saved;
                    this.#savedVersion = version;
                }
                catch (error) {
                    if (!this.#disposed)
                        this.error = error;
                    return false;
                }
            }
            return !this.#disposed;
        }).finally(() => {
            this.#pending = undefined;
            if (!this.#disposed)
                this.changed();
        });
        this.changed();
        return this.#pending;
    }
}
