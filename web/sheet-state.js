export const abilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
export const skills = Object.freeze([
    ["acrobatics", "DEX"], ["animal handling", "WIS"], ["arcana", "INT"],
    ["athletics", "STR"], ["deception", "CHA"], ["history", "INT"],
    ["insight", "WIS"], ["intimidation", "CHA"], ["investigation", "INT"],
    ["medicine", "WIS"], ["nature", "INT"], ["perception", "WIS"],
    ["performance", "CHA"], ["persuasion", "CHA"], ["religion", "INT"],
    ["sleight of hand", "DEX"], ["stealth", "DEX"], ["survival", "WIS"],
]);
export function blankSheet() {
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
export function normalizeSheet(value) {
    const raw = record(value);
    const blank = blankSheet();
    const normalized = { ...blank, ...cloneRecord(raw), v: 3 };
    normalized.rulesMode = raw["rulesMode"] === "manual" ? "manual" : "auto";
    normalized.rulesProvider = nullableRecord(raw["rulesProvider"]);
    for (const field of ["player", "className", "subclass", "race", "species", "background", "alignment", "lineage", "notes", "ruleset"]) {
        normalized[field] = text(raw[field], blank[field]);
    }
    for (const field of ["level", "maxHp", "hp", "tempHp", "ac", "initiative", "speed", "profBonus"]) {
        normalized[field] = number(raw[field], blank[field]);
    }
    normalized.level = Math.max(1, Math.trunc(normalized.level));
    normalized.hp = Math.max(0, normalized.hp);
    normalized.maxHp = Math.max(0, normalized.maxHp);
    normalized.tempHp = Math.max(0, normalized.tempHp);
    normalized.abilities = normalizeAbilities(raw["abilities"], blank.abilities);
    normalized.baseStats = raw["baseStats"] === null || raw["baseStats"] === undefined
        ? null : normalizeAbilities(raw["baseStats"], normalized.abilities);
    for (const field of ["saveProf", "skillProf", "skillExpertise", "activeFeatures"])
        normalized[field] = booleanMap(raw[field]);
    normalized.manualSaveProf = booleanMap(Object.hasOwn(raw, "manualSaveProf") ? raw["manualSaveProf"] : raw["saveProf"]);
    for (const field of ["preparedSpells", "spellbook", "cantrips", "grantChoices"])
        normalized[field] = stringArrayMap(raw[field]);
    for (const field of ["grantCastingAbilities", "resourceUses", "traitSnapshot", "overrides", "featureChoices"])
        normalized[field] = cloneRecord(record(raw[field]));
    normalized.spells = normalizeSpells(raw["spells"]);
    normalized.inventory = normalizeInventory(raw["inventory"]);
    normalized.resources = normalizeResources(raw["resources"]);
    for (const field of ["spellSwaps", "classes", "abilityGrants", "extraFeats"])
        normalized[field] = recordArray(raw[field]);
    normalized.feats = Array.isArray(raw["feats"]) ? structuredClone(raw["feats"]) : [];
    normalized.manualScores = raw["manualScores"] === true;
    normalized.currency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...numberMap(raw["currency"]) };
    return normalized;
}
export function cloneSheet(sheet) {
    return normalizeSheet(structuredClone(sheet));
}
export function abilityModifier(score) {
    return Math.floor((score - 10) / 2);
}
export function signed(value) {
    return value >= 0 ? `+${value}` : String(value);
}
export function createId(prefix) {
    return `${prefix}-${crypto.randomUUID()}`;
}
function normalizeAbilities(value, fallback) {
    const source = record(value);
    return Object.fromEntries(abilities.map((ability) => [ability, number(source[ability], fallback[ability])]));
}
function normalizeInventory(value) {
    return recordArray(value).map((item, index) => ({ ...item, id: text(item["id"], `item-${index}`), name: text(item["name"]), qty: Math.max(0, number(item["qty"], 1)), location: text(item["location"], "pack"), notes: text(item["notes"]) }));
}
function normalizeSpells(value) {
    return recordArray(value).map((item, index) => ({ ...item, id: text(item["id"], `spell-${index}`), name: text(item["name"]), level: Math.max(0, number(item["level"])), school: text(item["school"]), prepared: item["prepared"] === true, origin: text(item["origin"], "manual") }));
}
function normalizeResources(value) {
    return recordArray(value).map((item, index) => ({ ...item, id: text(item["id"], `resource-${index}`), name: text(item["name"]), current: Math.max(0, number(item["current"])), max: Math.max(0, number(item["max"])) }));
}
function stringArrayMap(value) {
    return Object.fromEntries(Object.entries(record(value)).filter(([, candidate]) => Array.isArray(candidate)).map(([key, candidate]) => [key, candidate.filter((item) => typeof item === "string")]));
}
function booleanMap(value) {
    return Object.fromEntries(Object.entries(record(value)).filter(([, candidate]) => typeof candidate === "boolean"));
}
function numberMap(value) {
    return Object.fromEntries(Object.entries(record(value)).filter(([, candidate]) => Number.isFinite(Number(candidate))).map(([key, candidate]) => [key, Number(candidate)]));
}
function recordArray(value) {
    return Array.isArray(value) ? value.filter(isRecord).map(cloneRecord) : [];
}
function nullableRecord(value) {
    return isRecord(value) ? cloneRecord(value) : null;
}
function record(value) { return isRecord(value) ? value : {}; }
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function cloneRecord(value) { return structuredClone(value); }
function text(value, fallback = "") { return typeof value === "string" ? value : fallback; }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
