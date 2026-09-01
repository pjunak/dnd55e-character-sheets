export const abilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export type Ability = typeof abilities[number];

export const skills = Object.freeze([
  ["acrobatics", "DEX"], ["animal handling", "WIS"], ["arcana", "INT"],
  ["athletics", "STR"], ["deception", "CHA"], ["history", "INT"],
  ["insight", "WIS"], ["intimidation", "CHA"], ["investigation", "INT"],
  ["medicine", "WIS"], ["nature", "INT"], ["perception", "WIS"],
  ["performance", "CHA"], ["persuasion", "CHA"], ["religion", "INT"],
  ["sleight of hand", "DEX"], ["stealth", "DEX"], ["survival", "WIS"],
] as const);

export interface SheetListItem extends Record<string, unknown> {
  id: string;
  name: string;
}

export interface InventoryItem extends SheetListItem {
  qty: number;
  location: string;
  notes: string;
}

export interface SpellItem extends SheetListItem {
  level: number;
  school: string;
  prepared: boolean;
  origin: string;
}

export interface ResourceItem extends SheetListItem {
  current: number;
  max: number;
}

export interface SheetState extends Record<string, unknown> {
  v: number;
  ruleset: string;
  rulesMode: "auto" | "manual";
  rulesProvider: Record<string, unknown> | null;
  player: string;
  className: string;
  subclass: string;
  race: string;
  species: string;
  background: string;
  alignment: string;
  level: number;
  abilities: Record<Ability, number>;
  maxHp: number;
  hp: number;
  tempHp: number;
  ac: number;
  initiative: number;
  speed: number;
  profBonus: number;
  saveProf: Record<string, boolean>;
  manualSaveProf: Record<string, boolean>;
  skillProf: Record<string, boolean>;
  skillExpertise: Record<string, boolean>;
  spells: SpellItem[];
  preparedSpells: Record<string, string[]>;
  spellbook: Record<string, string[]>;
  spellSwaps: Record<string, unknown>[];
  cantrips: Record<string, string[]>;
  grantChoices: Record<string, string[]>;
  grantCastingAbilities: Record<string, unknown>;
  inventory: InventoryItem[];
  resources: ResourceItem[];
  resourceUses: Record<string, unknown>;
  activeFeatures: Record<string, boolean>;
  traitSnapshot: Record<string, unknown>;
  currency: Record<string, number>;
  overrides: Record<string, unknown>;
  baseStats: Record<Ability, number> | null;
  manualScores: boolean;
  classes: Record<string, unknown>[];
  lineage: string;
  abilityGrants: Record<string, unknown>[];
  featureChoices: Record<string, unknown>;
  feats: unknown[];
  extraFeats: Record<string, unknown>[];
  notes: string;
}

export function blankSheet(): SheetState {
  return {
    v: 3, ruleset: "", rulesMode: "auto", rulesProvider: null,
    player: "", className: "", subclass: "", race: "", species: "",
    background: "", alignment: "", level: 1,
    abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    maxHp: 0, hp: 0, tempHp: 0, ac: 10, initiative: 0, speed: 30, profBonus: 2,
    saveProf: {}, manualSaveProf: {}, skillProf: {}, skillExpertise: {},
    spells: [], preparedSpells: {}, spellbook: {}, spellSwaps: [], cantrips: {},
    grantChoices: {}, grantCastingAbilities: {}, inventory: [], resources: [],
    resourceUses: {}, activeFeatures: {},
    traitSnapshot: { languages: [], senses: {}, resistances: [], damageImmunities: [], conditionImmunities: [], armor: [], weapons: [], tools: [] },
    currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 }, overrides: {},
    baseStats: null, manualScores: false, classes: [], lineage: "",
    abilityGrants: [], featureChoices: {}, feats: [], extraFeats: [], notes: "",
  };
}

export function normalizeSheet(value: unknown): SheetState {
  const raw = record(value);
  const blank = blankSheet();
  const normalized = { ...blank, ...cloneRecord(raw), v: 3 } as SheetState;
  normalized.rulesMode = raw["rulesMode"] === "manual" ? "manual" : "auto";
  normalized.rulesProvider = nullableRecord(raw["rulesProvider"]);
  for (const field of ["player", "className", "subclass", "race", "species", "background", "alignment", "lineage", "notes", "ruleset"] as const) {
    normalized[field] = text(raw[field], blank[field]);
  }
  for (const field of ["level", "maxHp", "hp", "tempHp", "ac", "initiative", "speed", "profBonus"] as const) {
    normalized[field] = number(raw[field], blank[field]);
  }
  normalized.level = Math.max(1, Math.trunc(normalized.level));
  normalized.hp = Math.max(0, normalized.hp);
  normalized.maxHp = Math.max(0, normalized.maxHp);
  normalized.tempHp = Math.max(0, normalized.tempHp);
  normalized.abilities = normalizeAbilities(raw["abilities"], blank.abilities);
  normalized.baseStats = raw["baseStats"] === null || raw["baseStats"] === undefined
    ? null : normalizeAbilities(raw["baseStats"], normalized.abilities);
  for (const field of ["saveProf", "skillProf", "skillExpertise", "activeFeatures"] as const) normalized[field] = booleanMap(raw[field]);
  normalized.manualSaveProf = booleanMap(Object.hasOwn(raw, "manualSaveProf") ? raw["manualSaveProf"] : raw["saveProf"]);
  for (const field of ["preparedSpells", "spellbook", "cantrips", "grantChoices"] as const) normalized[field] = stringArrayMap(raw[field]);
  for (const field of ["grantCastingAbilities", "resourceUses", "traitSnapshot", "overrides", "featureChoices"] as const) normalized[field] = cloneRecord(record(raw[field]));
  normalized.spells = normalizeSpells(raw["spells"]);
  normalized.inventory = normalizeInventory(raw["inventory"]);
  normalized.resources = normalizeResources(raw["resources"]);
  for (const field of ["spellSwaps", "classes", "abilityGrants", "extraFeats"] as const) normalized[field] = recordArray(raw[field]);
  normalized.feats = Array.isArray(raw["feats"]) ? structuredClone(raw["feats"]) : [];
  normalized.manualScores = raw["manualScores"] === true;
  normalized.currency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...numberMap(raw["currency"]) };
  return normalized;
}

export function cloneSheet(sheet: SheetState): SheetState {
  return normalizeSheet(structuredClone(sheet));
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalizeAbilities(value: unknown, fallback: Record<Ability, number>): Record<Ability, number> {
  const source = record(value);
  return Object.fromEntries(abilities.map((ability) => [ability, number(source[ability], fallback[ability])])) as Record<Ability, number>;
}

function normalizeInventory(value: unknown): InventoryItem[] {
  return recordArray(value).map((item, index) => ({ ...item, id: text(item["id"], `item-${index}`), name: text(item["name"]), qty: Math.max(0, number(item["qty"], 1)), location: text(item["location"], "pack"), notes: text(item["notes"]) }));
}

function normalizeSpells(value: unknown): SpellItem[] {
  return recordArray(value).map((item, index) => ({ ...item, id: text(item["id"], `spell-${index}`), name: text(item["name"]), level: Math.max(0, number(item["level"])), school: text(item["school"]), prepared: item["prepared"] === true, origin: text(item["origin"], "manual") }));
}

function normalizeResources(value: unknown): ResourceItem[] {
  return recordArray(value).map((item, index) => ({ ...item, id: text(item["id"], `resource-${index}`), name: text(item["name"]), current: Math.max(0, number(item["current"])), max: Math.max(0, number(item["max"])) }));
}

function stringArrayMap(value: unknown): Record<string, string[]> {
  return Object.fromEntries(Object.entries(record(value)).filter(([, candidate]) => Array.isArray(candidate)).map(([key, candidate]) => [key, (candidate as unknown[]).filter((item): item is string => typeof item === "string")]));
}

function booleanMap(value: unknown): Record<string, boolean> {
  return Object.fromEntries(Object.entries(record(value)).filter(([, candidate]) => typeof candidate === "boolean")) as Record<string, boolean>;
}

function numberMap(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value)).filter(([, candidate]) => Number.isFinite(Number(candidate))).map(([key, candidate]) => [key, Number(candidate)]));
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord).map(cloneRecord) : [];
}

function nullableRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? cloneRecord(value) : null;
}

function record(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function cloneRecord(value: Record<string, unknown>): Record<string, unknown> { return structuredClone(value); }
function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function number(value: unknown, fallback = 0): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
