import type { ServiceHandle } from "./sdk.js";
import { cloneSheet, normalizeSheet, type Ability, type SheetState, abilities } from "./sheet-state.js";

export interface EngineIdentity extends Record<string, unknown> { readonly edition?: string }
export interface Hydration { readonly sheet: Record<string, unknown>; readonly warnings: readonly string[]; readonly identity?: EngineIdentity }
export interface BuilderChoice extends Record<string, unknown> { readonly id: string; readonly kind: string; readonly count?: number; readonly from?: readonly string[]; readonly prompt?: string }
export interface BuilderPlan extends Record<string, unknown> {
  readonly edition: string;
  readonly baseStats: Readonly<Record<string, unknown>>;
  readonly classes: readonly Record<string, unknown>[];
  readonly classChoices: readonly BuilderChoice[];
  readonly creationChoices: readonly BuilderChoice[];
  readonly creationAbilityChoices: readonly BuilderChoice[];
}
export interface BuilderPlanResult { readonly available: boolean; readonly status: string; readonly plan?: BuilderPlan; readonly identity?: EngineIdentity; readonly errors: readonly string[] }
export interface RuleRecord extends Record<string, unknown> { readonly id: string; readonly kind: string; readonly name?: string }

export class RulesEngineClient {
  readonly #handle: ServiceHandle;
  readonly #signal: AbortSignal;

  constructor(handle: ServiceHandle, signal: AbortSignal) { this.#handle = handle; this.#signal = signal; }
  get available(): boolean { return this.#handle.available; }
  get providerLabel(): string { return this.#handle.providers[0]?.addonId ?? "not connected"; }
  get providerIdentity(): Readonly<Record<string, unknown>> {
    const provider = this.#handle.providers[0];
    return provider === undefined ? {} : {
      engineAddonId: provider.addonId,
      engineContractVersion: provider.contractVersion,
      engineGeneration: provider.generation,
      engineBindingRevision: provider.bindingRevision,
    };
  }

  hydrate(decisions: SheetState): Promise<Hydration> {
    return this.#handle.call("hydrate", { contractVersion: "rules-engine-hydrate.v1", decisions }, { deadlineMs: 15_000, signal: this.#signal });
  }

  builderPlan(decisions: SheetState): Promise<BuilderPlanResult> {
    return this.#handle.call("builder-plan", { contractVersion: "rules-engine-builder-plan.v1", decisions }, { deadlineMs: 15_000, signal: this.#signal });
  }

  applyChoice(decisions: SheetState, change: { readonly choiceId: string; readonly slot?: number; readonly value: unknown }): Promise<{ readonly available: boolean; readonly decisions: Record<string, unknown>; readonly errors: readonly string[] }> {
    return this.#handle.call("apply-builder-choice", { contractVersion: "rules-engine-builder-change.v1", decisions, change }, { deadlineMs: 15_000, signal: this.#signal });
  }

  reconcile(decisions: SheetState): Promise<{ readonly available: boolean; readonly decisions: Record<string, unknown>; readonly errors: readonly string[] }> {
    return this.#handle.call("reconcile-builder-decisions", { contractVersion: "rules-engine-builder-reconcile.v1", decisions }, { deadlineMs: 15_000, signal: this.#signal });
  }

  async queryAll(kind: string): Promise<readonly RuleRecord[]> {
    const records: RuleRecord[] = [];
    let cursor: string | undefined;
    do {
      const request: Record<string, unknown> = { contractVersion: "rules-engine-query.v1", kind, limit: 200 };
      if (cursor !== undefined) request["cursor"] = cursor;
      const page = await this.#handle.call<{ readonly records: readonly RuleRecord[]; readonly nextCursor?: string }>("query-records", request, { deadlineMs: 6_000, signal: this.#signal });
      records.push(...page.records);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return records;
  }
}

export function applyDecisions(current: SheetState, decisions: Record<string, unknown>): SheetState {
  return normalizeSheet({ ...current, ...structuredClone(decisions) });
}

export function materializeHydration(
  current: SheetState,
  hydration: Hydration,
  engineIdentity: Readonly<Record<string, unknown>> = {},
): SheetState {
  const next = cloneSheet(current);
  const computed = hydration.sheet;
  const derived = asRecord(computed["derived"]);
  const computedAbilities = asRecord(computed["abilities"]);
  for (const ability of abilities) {
    const value = asRecord(computedAbilities[ability])["score"];
    if (finite(value)) next.abilities[ability] = Number(value);
  }
  copyNumber(derived, "maxHp", next, "maxHp");
  copyNumber(derived, "armorClass", next, "ac");
  copyNumber(derived, "initiative", next, "initiative");
  copyNumber(derived, "speed", next, "speed");
  copyNumber(derived, "proficiencyBonus", next, "profBonus");
  if (finite(computed["totalLevel"])) next.level = Math.max(1, Number(computed["totalLevel"]));
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

function materializeSpellSnapshots(next: SheetState, computed: Record<string, unknown>): void {
  const snapshots: SheetState["spells"] = [];
  const seen = new Set<string>();
  const add = (reference: unknown, source: string): void => {
    if (typeof reference !== "string" || reference.length === 0 || seen.has(reference)) return;
    seen.add(reference);
    snapshots.push({ id: `snapshot:${reference}`, name: reference, level: 0, school: "", prepared: true, origin: "snapshot", source });
  };
  const spellcasting = asRecord(computed["spellcasting"]);
  const perClass = Array.isArray(spellcasting["perClass"]) ? spellcasting["perClass"] as unknown[] : [];
  for (const candidate of perClass) {
    const classState = asRecord(candidate);
    const classID = typeof classState["classId"] === "string" ? classState["classId"] : "class";
    for (const reference of next.cantrips[classID] ?? []) add(reference, classID);
    for (const reference of next.preparedSpells[classID] ?? []) add(reference, classID);
  }
  const granted = Array.isArray(spellcasting["granted"]) ? spellcasting["granted"] as unknown[] : [];
  for (const candidate of granted) add(asRecord(candidate)["ref"], "granted");
  next.spells = next.spells.filter((spell) => spell.origin !== "snapshot").concat(snapshots);
}

function boundedMaterializedSnapshot(sheet: Record<string, unknown>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const field of ["derived", "abilities", "saves", "skills", "languages", "senses", "resistances", "damageImmunities", "conditionImmunities", "proficiencies", "features", "spellcasting", "totalLevel"] as const) {
    if (sheet[field] !== undefined) snapshot[field] = structuredClone(sheet[field]);
  }
  return snapshot;
}

function materializeProficiencies(source: Record<string, unknown>, target: Record<string, boolean>, field: string): void {
  for (const [key, value] of Object.entries(source)) target[key] = asRecord(value)[field] === true;
}

function copyNumber(source: Record<string, unknown>, sourceField: string, target: SheetState, targetField: "maxHp" | "ac" | "initiative" | "speed" | "profBonus"): void {
  if (finite(source[sourceField])) target[targetField] = Number(source[sourceField]);
}
function finite(value: unknown): boolean { return Number.isFinite(Number(value)); }
function asRecord(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
