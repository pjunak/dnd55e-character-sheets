import type { AddonContext, ServiceHandle } from "./sdk.js";
import { cloneSheet, normalizeSheet, type Ability, type SheetState, abilities } from "./sheet-state.js";
import { serviceFailure, type RulesDiagnostics, type RulesStatus } from "./rules-status.js";

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
export interface BuilderPlanResult { readonly available: boolean; readonly status: string; readonly plan?: BuilderPlan; readonly guidance?: Record<string, unknown>; readonly identity?: EngineIdentity; readonly errors: readonly string[] }
export interface RuleRecord extends Record<string, unknown> { readonly id: string; readonly kind: string; readonly name?: string }
export type PlayChange =
  | { readonly operation: "rest"; readonly rest: "short" | "long" }
  | { readonly operation: "spend-hit-die"; readonly key: string }
  | { readonly operation: "toggle-feature"; readonly key: string; readonly enabled: boolean }
  | { readonly operation: "select-spell"; readonly classId: string; readonly ref: string; readonly selection: "cantrips" | "spellbook" | "preparedSpells"; readonly selected: boolean }
  | { readonly operation: "cast-spell"; readonly classId: string; readonly ref: string; readonly slot: string }
  | { readonly operation: "select-grant-spell"; readonly key: string; readonly ref: string; readonly selected: boolean }
  | { readonly operation: "select-casting-ability"; readonly key: string; readonly ability: string }
  | { readonly operation: "cast-granted-spell"; readonly key: string; readonly slot: string }
  | { readonly operation: "cast-ritual"; readonly classId: string; readonly ref: string }
  | { readonly operation: "copy-spell"; readonly classId: string; readonly ref: string; readonly scrollId: string }
  | { readonly operation: "swap-spell"; readonly classId: string; readonly out: string; readonly ref: string };
export interface PlayResult extends Hydration { readonly available: boolean; readonly status: string; readonly decisions: Record<string, unknown>; readonly errors: readonly string[]; readonly options?: Record<string, unknown> }

export class RulesEngineClient {
  readonly #handle: ServiceHandle;
  readonly #signal: AbortSignal;
  #diagnostics: RulesDiagnostics;

  constructor(handle: ServiceHandle, signal: AbortSignal, discoveryError?: unknown) {
    this.#handle = handle; this.#signal = signal;
    this.#diagnostics = discoveryError === undefined ? { status: handle.available ? "unchecked" : "missing-engine", errors: [] } : { ...serviceFailure(discoveryError), status: "connection-error" };
  }
  get diagnostics(): RulesDiagnostics { return structuredClone(this.#diagnostics); }
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

  async inspect(): Promise<RulesDiagnostics> {
    this.#signal.throwIfAborted();
    if (!this.available) { this.#diagnostics = { ...this.#diagnostics, checkedAt: Date.now() }; return this.diagnostics; }
    await this.#call("context", {}, 6_000).catch(() => { this.#signal.throwIfAborted(); });
    return this.diagnostics;
  }

  async #call<T>(method: string, params: unknown, deadlineMs: number): Promise<T> {
    try {
      const result = await this.#handle.call<T>(method, params, { deadlineMs, signal: this.#signal });
      this.#signal.throwIfAborted();
      const value = asRecord(result), status = value["status"];
      if (["ready", "missing", "unavailable", "incompatible", "stale"].includes(String(status))) {
        this.#diagnostics = { status: status as RulesStatus, checkedAt: Date.now(), errors: Array.isArray(value["errors"]) ? value["errors"].filter((error): error is string => typeof error === "string") : [], ...(value["available"] === true ? { identity: structuredClone(asRecord(value["identity"])) } : {}) };
      } else if (method === "hydrate") {
        const identity = value["identity"];
        this.#diagnostics = identity ? { status: "ready", identity: structuredClone(asRecord(identity)), checkedAt: Date.now(), errors: [] }
          : { status: "unavailable", checkedAt: Date.now(), errors: Array.isArray(value["warnings"]) ? value["warnings"].filter((warning): warning is string => typeof warning === "string") : [] };
      }
      return result;
    } catch (error) {
      this.#signal.throwIfAborted();
      const failure = serviceFailure(error);
      // Rejected character choices do not mean the provider went offline.
      if (method === "context" || failure.code !== "INVALID_REQUEST") this.#diagnostics = { ...failure, checkedAt: Date.now() };
      throw error;
    }
  }

  hydrate(decisions: SheetState): Promise<Hydration> {
    return this.#call("hydrate", { contractVersion: "rules-engine-hydrate.v1", decisions }, 15_000);
  }

  playChange(decisions: SheetState, change: PlayChange): Promise<PlayResult> {
    return this.#call("apply-play-change", { contractVersion: "rules-engine-play-change.v1", decisions, change }, 15_000);
  }

  spellOptions(decisions: SheetState): Promise<PlayResult> {
    return this.#call("spell-options", { contractVersion: "rules-engine-spell-options.v1", decisions }, 15_000);
  }

  builderPlan(decisions: SheetState): Promise<BuilderPlanResult> {
    return this.#call("builder-plan", { contractVersion: "rules-engine-builder-plan.v1", decisions }, 15_000);
  }

  applyChoice(decisions: SheetState, change: { readonly choiceId: string; readonly slot?: number; readonly value: unknown }): Promise<{ readonly available: boolean; readonly decisions: Record<string, unknown>; readonly errors: readonly string[] }> {
    return this.#call("apply-builder-choice", { contractVersion: "rules-engine-builder-change.v1", decisions, change }, 15_000);
  }

  reconcile(decisions: SheetState): Promise<{ readonly available: boolean; readonly decisions: Record<string, unknown>; readonly errors: readonly string[] }> {
    return this.#call("reconcile-builder-decisions", { contractVersion: "rules-engine-builder-reconcile.v1", decisions }, 15_000);
  }

  async queryAll(kind: string): Promise<readonly RuleRecord[]> {
    const records: RuleRecord[] = [];
    let cursor: string | undefined;
    do {
      const request: Record<string, unknown> = { contractVersion: "rules-engine-query.v1", kind, limit: 200 };
      if (cursor !== undefined) request["cursor"] = cursor;
      const page = await this.#call<{ readonly records: readonly RuleRecord[]; readonly nextCursor?: string }>("query-records", request, 6_000);
      for (const record of page.records) {
        records.push({ ...asRecord(record["value"]), id: record.id, kind: record.kind });
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return records;
  }
}

export async function connectRulesEngine(context: AddonContext, viewSignal: AbortSignal = context.signal): Promise<RulesEngineClient> {
  const signal = AbortSignal.any([context.signal, viewSignal]); signal.throwIfAborted();
  try {
    const service = await context.services.connect("dnd5e.rules-engine", { range: "^3.0.0", cardinality: "one", signal });
    signal.throwIfAborted(); return new RulesEngineClient(service, signal);
  } catch (error) {
    signal.throwIfAborted();
    return new RulesEngineClient({ available: false, providers: [], call: async () => { throw error; } }, signal, error);
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
  if (hydration.identity === undefined) throw new Error(hydration.warnings.join(" ") || "Rules data is unavailable. Saved values have been kept.");
  const next = cloneSheet(current);
  // Scores in a hydrated sheet include grants; keep their original input for the next calculation.
  next.baseStats ??= { ...current.abilities };
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
  for (const field of ["maxHp", "ac", "initiative", "speed"] as const) {
    const override = next.overrides[field];
    if (finite(override)) next[field] = field === "initiative" ? Number(override) : Math.max(0, Number(override));
  }
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
  const previous = new Map(next.spells.filter(spell => spell.origin === "snapshot").map(spell => [spell.id, spell]));
  const add = (reference: unknown, source: string): void => {
    if (typeof reference !== "string" || reference.length === 0 || seen.has(reference)) return;
    seen.add(reference);
    const id = `snapshot:${reference}`;
    snapshots.push({ id, name: reference, level: 0, school: "", prepared: true, ...previous.get(id), origin: "snapshot", source });
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
  for (const field of ["derived", "abilities", "saves", "skills", "languages", "senses", "resistances", "damageImmunities", "conditionImmunities", "proficiencies", "features", "spellcasting", "totalLevel", "resources", "weapons", "attunement", "activations"] as const) {
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
function finite(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value); }
function asRecord(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
