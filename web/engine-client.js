import { cloneSheet, normalizeSheet, abilities } from "./sheet-state.js";
export class RulesEngineClient {
    #handle;
    #signal;
    constructor(handle, signal) { this.#handle = handle; this.#signal = signal; }
    get available() { return this.#handle.available; }
    get providerLabel() { return this.#handle.providers[0]?.addonId ?? "not connected"; }
    get providerIdentity() {
        const provider = this.#handle.providers[0];
        return provider === undefined ? {} : {
            engineAddonId: provider.addonId,
            engineContractVersion: provider.contractVersion,
            engineGeneration: provider.generation,
            engineBindingRevision: provider.bindingRevision,
        };
    }
    hydrate(decisions) {
        return this.#handle.call("hydrate", { contractVersion: "rules-engine-hydrate.v1", decisions }, { deadlineMs: 15_000, signal: this.#signal });
    }
    playChange(decisions, change) {
        return this.#handle.call("apply-play-change", { contractVersion: "rules-engine-play-change.v1", decisions, change }, { deadlineMs: 15_000, signal: this.#signal });
    }
    builderPlan(decisions) {
        return this.#handle.call("builder-plan", { contractVersion: "rules-engine-builder-plan.v1", decisions }, { deadlineMs: 15_000, signal: this.#signal });
    }
    applyChoice(decisions, change) {
        return this.#handle.call("apply-builder-choice", { contractVersion: "rules-engine-builder-change.v1", decisions, change }, { deadlineMs: 15_000, signal: this.#signal });
    }
    reconcile(decisions) {
        return this.#handle.call("reconcile-builder-decisions", { contractVersion: "rules-engine-builder-reconcile.v1", decisions }, { deadlineMs: 15_000, signal: this.#signal });
    }
    async queryAll(kind) {
        const records = [];
        let cursor;
        do {
            const request = { contractVersion: "rules-engine-query.v1", kind, limit: 200 };
            if (cursor !== undefined)
                request["cursor"] = cursor;
            const page = await this.#handle.call("query-records", request, { deadlineMs: 6_000, signal: this.#signal });
            for (const record of page.records) {
                records.push({ ...asRecord(record["value"]), id: record.id, kind: record.kind });
            }
            cursor = page.nextCursor;
        } while (cursor !== undefined);
        return records;
    }
}
export function applyDecisions(current, decisions) {
    return normalizeSheet({ ...current, ...structuredClone(decisions) });
}
export function materializeHydration(current, hydration, engineIdentity = {}) {
    if (hydration.identity === undefined)
        throw new Error(hydration.warnings.join(" ") || "Rules data is unavailable. Saved values have been kept.");
    const next = cloneSheet(current);
    // Scores in a hydrated sheet include grants; keep their original input for the next calculation.
    next.baseStats ??= { ...current.abilities };
    const computed = hydration.sheet;
    const derived = asRecord(computed["derived"]);
    const computedAbilities = asRecord(computed["abilities"]);
    for (const ability of abilities) {
        const value = asRecord(computedAbilities[ability])["score"];
        if (finite(value))
            next.abilities[ability] = Number(value);
    }
    copyNumber(derived, "maxHp", next, "maxHp");
    copyNumber(derived, "armorClass", next, "ac");
    copyNumber(derived, "initiative", next, "initiative");
    copyNumber(derived, "speed", next, "speed");
    copyNumber(derived, "proficiencyBonus", next, "profBonus");
    for (const field of ["maxHp", "ac", "initiative", "speed"]) {
        const override = next.overrides[field];
        if (finite(override))
            next[field] = field === "initiative" ? Number(override) : Math.max(0, Number(override));
    }
    if (finite(computed["totalLevel"]))
        next.level = Math.max(1, Number(computed["totalLevel"]));
    next.hp = Math.min(next.hp, next.maxHp);
    materializeProficiencies(asRecord(computed["saves"]), next.saveProf, "proficient");
    materializeProficiencies(asRecord(computed["skills"]), next.skillProf, "proficient");
    materializeProficiencies(asRecord(computed["skills"]), next.skillExpertise, "expertise");
    materializeSpellSnapshots(next, computed);
    const identity = { ...structuredClone(engineIdentity), ...(hydration.identity ?? {}) };
    next.ruleset = typeof identity["edition"] === "string" ? identity["edition"] : next.ruleset;
    next.rulesProvider = { identity: structuredClone(identity), edition: next.ruleset, materialized: boundedMaterializedSnapshot(computed) };
    next.rulesMode = "auto";
    return next;
}
function materializeSpellSnapshots(next, computed) {
    const snapshots = [];
    const seen = new Set();
    const previous = new Map(next.spells.filter(spell => spell.origin === "snapshot").map(spell => [spell.id, spell]));
    const add = (reference, source) => {
        if (typeof reference !== "string" || reference.length === 0 || seen.has(reference))
            return;
        seen.add(reference);
        const id = `snapshot:${reference}`;
        snapshots.push({ id, name: reference, level: 0, school: "", prepared: true, ...previous.get(id), origin: "snapshot", source });
    };
    const spellcasting = asRecord(computed["spellcasting"]);
    const perClass = Array.isArray(spellcasting["perClass"]) ? spellcasting["perClass"] : [];
    for (const candidate of perClass) {
        const classState = asRecord(candidate);
        const classID = typeof classState["classId"] === "string" ? classState["classId"] : "class";
        for (const reference of next.cantrips[classID] ?? [])
            add(reference, classID);
        for (const reference of next.preparedSpells[classID] ?? [])
            add(reference, classID);
    }
    const granted = Array.isArray(spellcasting["granted"]) ? spellcasting["granted"] : [];
    for (const candidate of granted)
        add(asRecord(candidate)["ref"], "granted");
    next.spells = next.spells.filter((spell) => spell.origin !== "snapshot").concat(snapshots);
}
function boundedMaterializedSnapshot(sheet) {
    const snapshot = {};
    for (const field of ["derived", "abilities", "saves", "skills", "languages", "senses", "resistances", "damageImmunities", "conditionImmunities", "proficiencies", "features", "spellcasting", "totalLevel", "resources", "weapons", "attunement", "activations"]) {
        if (sheet[field] !== undefined)
            snapshot[field] = structuredClone(sheet[field]);
    }
    return snapshot;
}
function materializeProficiencies(source, target, field) {
    for (const [key, value] of Object.entries(source))
        target[key] = asRecord(value)[field] === true;
}
function copyNumber(source, sourceField, target, targetField) {
    if (finite(source[sourceField]))
        target[targetField] = Number(source[sourceField]);
}
function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function asRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}; }
