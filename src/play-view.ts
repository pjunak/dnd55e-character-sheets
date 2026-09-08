import { abilities, abilityModifier, createId, signed, skills, type Ability, type SheetState } from "./sheet-state.js";
import type { RuleRecord } from "./engine-client.js";
import { equipmentSlot, type EquipmentSlot } from "./equipment-state.js";

export type Layout = "compact" | "classic";
export interface PlayView {
  readonly document: Document;
  readonly state: SheetState;
  readonly editable: boolean;
  readonly layout: Layout;
  readonly save: (change: (draft: SheetState) => void) => void;
  readonly addItem?: () => void;
  readonly equipment?: readonly RuleRecord[];
  readonly fillSlot?: (slot: EquipmentSlot) => void;
  readonly clearSlot?: (itemId: string) => void;
}
const abilityNames: Record<Ability, string> = { STR: "Strength", DEX: "Dexterity", CON: "Constitution", INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma" };
const aliases: Record<string, string> = { "animal handling": "animalHandling", "sleight of hand": "sleightOfHand" };

export function savedComputed(state: SheetState): Record<string, unknown> { return record(state.rulesProvider?.["materialized"]); }
export function preferredLayout(storage: Storage | undefined, key: string): Layout {
  try {
    const value = storage?.getItem(`dse-ui:renderer:${key}`) ?? storage?.getItem(`dse-ui:layout:${key}`) ?? storage?.getItem("dse-ui:layout");
    return value === "builtin:classic" || value === "classic" ? "classic" : "compact";
  } catch { return "compact"; }
}

export function abilityRail(view: PlayView): HTMLElement {
  const { document, state, layout, editable, save } = view;
  const rail = el(document, "div", "dse-cards");
  const computed = savedComputed(state);
  for (const ability of abilities) {
    const card = el(document, "section", "codex-surface dse-ability");
    const title = el(document, "div", "dse-ability-title");
    title.append(el(document, "span", "", abilityNames[ability]));
    const dock = el(document, "span", "dse-dock-slot");
    if (layout === "compact" && ability === "DEX") dock.append(el(document, "span", "dse-dock", `⚡ Init ${signed(state.initiative)}`));
    if (layout === "compact" && ability === "WIS") dock.append(el(document, "span", "dse-dock", `👁 Passive ${passive(state)}`));
    title.append(dock);
    const shield = button(document, "", () => save(draft => { draft.saveProf[ability] = !draft.saveProf[ability]; draft.manualSaveProf[ability] = draft.saveProf[ability]; }), !editable);
    shield.className = "dse-dot dse-shield";
    shield.append(icon(document, "M12 2.4 19.3 5.3V11c0 4.8-3.3 8.6-7.3 10.5C8 19.6 4.7 15.8 4.7 11V5.3Z"));
    shield.setAttribute("aria-label", `${abilityNames[ability]} saving throw proficiency`);
    shield.setAttribute("aria-pressed", String(state.saveProf[ability] === true));
    const saveTotal = abilityModifier(state.abilities[ability]) + (state.saveProf[ability] ? state.profBonus : 0);
    title.append(shield, el(document, "strong", "dse-total", signed(saveTotal)));
    const tile = el(document, "div", "dse-score");
    tile.append(el(document, "strong", "", signed(abilityModifier(state.abilities[ability]))));
    tile.append(number(view, abilityNames[ability], state.abilities[ability], (draft, value) => { draft.abilities[ability] = Math.max(1, Math.min(30, value)); }, 1, 30));
    const details = el(document, "div", "dse-ability-details");
    if (layout === "classic") details.append(title);
    const casters = rows(record(computed["spellcasting"])["perClass"]).filter(caster => caster["ability"] === ability);
    if (layout === "compact") for (const caster of casters) {
      card.classList.add("dse-caster");
      details.append(el(document, "div", "dse-dock dse-casting", `Save DC ${numeric(caster["saveDC"], 0)} · Spell Atk ${signed(numeric(caster["spellAttack"], 0))}`));
    }
    const governed = skills.filter(([, key]) => key === ability);
    for (const [name] of governed) {
      const key = aliases[name] ?? name;
      const prof = proficiency(state.skillProf, name), expert = proficiency(state.skillExpertise, name);
      const line = el(document, "div", "dse-skill");
      const dot = button(document, expert ? "◆" : prof ? "●" : "○", () => save(draft => {
        const next = expert ? 0 : prof ? 2 : 1;
        draft.skillProf[key] = next > 0; draft.skillExpertise[key] = next === 2;
        if (key !== name) { draft.skillProf[name] = next > 0; draft.skillExpertise[name] = next === 2; }
      }), !editable);
      dot.className = "dse-dot"; dot.setAttribute("aria-label", `${label(name)} proficiency: ${expert ? "expertise" : prof ? "proficient" : "untrained"}`);
      const total = abilityModifier(state.abilities[ability]) + (expert ? 2 : prof ? 1 : 0) * state.profBonus;
      line.append(dot, el(document, "span", "", label(name)), el(document, "strong", "dse-total", signed(total)));
      details.append(line);
    }
    if (governed.length === 0) details.append(el(document, "span", "dse-empty", "No skills"));
    const body = el(document, "div", "dse-ability-body"); body.append(tile, details);
    if (layout === "compact") card.append(title);
    card.append(body); rail.append(card);
  }
  return rail;
}

export function vitals(view: PlayView): HTMLElement {
  const { document, state, editable, save } = view;
  const band = el(document, "div", "dse-vitals");
  const hp = el(document, "div", "codex-tile dse-hp");
  hp.append(el(document, "span", "dse-stat-label", "Hit points"));
  const counter = el(document, "div", "dse-counter");
  counter.append(button(document, "−", () => save(draft => { draft.hp = Math.max(0, draft.hp - 1); }), !editable, "Decrease hit points"),
    number(view, "Current HP", state.hp, (draft, value) => { draft.hp = Math.max(0, value); }, 0),
    el(document, "span", "", "/"), number(view, "Maximum HP", state.maxHp, (draft, value) => { draft.maxHp = Math.max(0, value); }, 0),
    button(document, "+", () => save(draft => { draft.hp += 1; }), !editable, "Increase hit points"));
  const temp = el(document, "label", "dse-temp"); temp.append(el(document, "span", "", "Temp"), number(view, "Temporary HP", state.tempHp, (draft, value) => { draft.tempHp = Math.max(0, value); }, 0));
  hp.append(counter, temp); band.append(hp);
  const ac = el(document, "label", "codex-tile dse-ac"); ac.append(el(document, "span", "dse-stat-label", "Armor class"), number(view, "Armor class", state.ac, (draft, value) => { draft.ac = value; }, 0)); band.append(ac);
  const stats = el(document, "div", "dse-vitals-grid");
  const speed = el(document, "label", "codex-tile"); speed.append(el(document, "span", "dse-stat-label", "Speed"), number(view, "Speed", state.speed, (draft, value) => { draft.speed = Math.max(0, value); }, 0)); stats.append(speed);
  const proficiencyTile = el(document, "label", "codex-tile"); proficiencyTile.append(el(document, "span", "dse-stat-label", "Proficiency"), number(view, "Proficiency", state.profBonus, (draft, value) => { draft.profBonus = value; })); stats.append(proficiencyTile);
  if (view.layout === "classic") {
    const initiative = el(document, "label", "codex-tile"); initiative.append(el(document, "span", "dse-stat-label", "Initiative"), number(view, "Initiative", state.initiative, (draft, value) => { draft.initiative = value; })); stats.append(initiative);
    const perception = el(document, "div", "codex-tile"); perception.append(el(document, "span", "dse-stat-label", "Passive"), el(document, "strong", "", String(passive(state)))); stats.append(perception);
    for (const caster of rows(record(savedComputed(state)["spellcasting"])["perClass"])) {
      for (const [name, value] of [["Save DC", caster["saveDC"]], ["Spell Atk", caster["spellAttack"]]] as const) {
        const stat = el(document, "div", "codex-tile"); stat.title = String(caster["classId"] ?? ""); stat.append(el(document, "span", "dse-stat-label", name), el(document, "strong", "", name === "Spell Atk" ? signed(numeric(value, 0)) : String(numeric(value, 0)))); stats.append(stat);
      }
    }
  }
  band.append(stats);
  const worn = state.inventory.filter(item => item.location === "equipped" || item["attuned"] === true);
  if (worn.length > 0 || editable) {
    const slots = el(document, "div", "dse-worn"); slots.append(el(document, "span", "dse-stat-label", "Worn · Attunement"));
    for (const [slot, title] of [["armor", "Armor"], ["shield", "Shield"], ["worn", "Worn"], ["attuned", "Attunement"]] as const) {
      const group = el(document, "div", "dse-worn-group"); group.append(el(document, "span", "dse-stat-label", title));
      const items = worn.filter(item => equipmentSlot(item, view.equipment ?? []) === slot);
      for (const item of items) {
        const token = el(document, "span", "dse-equipment-slot", `${slot === "attuned" ? "★ " : ""}${item.name}`);
        if (editable && view.clearSlot) token.append(button(document, "×", () => view.clearSlot!(item.id), false, `${slot === "attuned" ? "End attunement to" : "Unequip"} ${item.name}`)); group.append(token);
      }
      if (editable && view.fillSlot) group.append(button(document, `＋ ${title}`, () => view.fillSlot!(slot), false, `Fill ${title} slot`));
      else if (!items.length) group.append(el(document, "span", "dse-empty", "—"));
      slots.append(group);
    }
    band.append(slots);
  }
  return band;
}

export function backpack(view: PlayView): HTMLElement {
  const { document, state, save, editable } = view;
  const pack = el(document, "section", "dse-backpack");
  const heading = el(document, "div", "dse-bp-head");
  const title = el(document, "h3", "dse-bp-title"); title.append(icon(document, "M8 6V4a4 4 0 0 1 8 0v2M5 6h14v15H5ZM5 10h14M9 10v3h6v-3"), document.createTextNode("Backpack")); heading.append(title);
  if (editable) heading.append(button(document, "＋ Add item", view.addItem ?? (() => save(draft => { draft.inventory.push({ id: createId("item"), name: "New item", qty: 1, location: "pack", notes: "" }); }))));
  pack.append(heading);
  const split = el(document, "div", "dse-bp-split");
  const active = el(document, "div", "dse-bp-col"), stored = el(document, "div", "dse-bp-col dse-bp-right");
  const locations = [...new Set(["equipped", "ready", "pack", ...state.inventory.map(item => item.location)])];
  for (const location of locations) {
    const items = state.inventory.filter(item => item.location === location);
    const group = el(document, "div", "dse-bp-group"); group.append(el(document, "h4", "dse-bp-label", `${label(location)} · ${items.length}`));
    for (const item of items) {
      const row = el(document, "div", "dse-item"); row.dataset["item"] = item.id; row.title = item.notes;
      if (!editable) row.append(el(document, "span", "dse-item-name", item.name), el(document, "span", "", `× ${item.qty}${item["attuned"] ? " ★" : ""}`));
      else {
        const name = el(document, "input", "dse-item-name"); name.value = item.name; name.setAttribute("aria-label", "Item name");
        name.addEventListener("change", () => save(draft => { const target = draft.inventory.find(value => value.id === item.id); if (target) target.name = name.value; }));
        const qty = number(view, `${item.name} quantity`, item.qty, (draft, value) => { const target = draft.inventory.find(value => value.id === item.id); if (target) target.qty = Math.max(0, value); }, 0);
        const attune = button(document, item["attuned"] ? "★" : "☆", () => save(draft => { const target = draft.inventory.find(value => value.id === item.id); if (target) target["attuned"] = !target["attuned"]; }), false, `Attune ${item.name}`); attune.setAttribute("aria-pressed", String(item["attuned"] === true));
        const move = el(document, "select", "dse-item-location"); move.setAttribute("aria-label", `Move ${item.name}`);
        for (const loc of locations) { const option = el(document, "option", "", label(loc)); option.value = loc; move.append(option); } move.value = location;
        move.addEventListener("change", () => save(draft => { const target = draft.inventory.find(value => value.id === item.id); if (target) target.location = move.value; }));
        row.append(name, qty, attune, move, button(document, "×", () => save(draft => { draft.inventory = draft.inventory.filter(value => value.id !== item.id); }), false, `Remove ${item.name}`));
        const details = el(document, "details", "dse-item-notes"), summary = el(document, "summary", "", "Notes"), notes = el(document, "textarea");
        notes.value = item.notes; notes.rows = 2; notes.setAttribute("aria-label", `${item.name} notes`);
        notes.addEventListener("change", () => save(draft => { const target = draft.inventory.find(value => value.id === item.id); if (target) target.notes = notes.value; }));
        details.append(summary, notes); row.append(details);
      }
      group.append(row);
    }
    if (items.length === 0) group.append(el(document, "p", "dse-empty", "Empty"));
    (location === "equipped" || location === "ready" ? active : stored).append(group);
  }
  split.append(active, stored); pack.append(split);
  const coins = el(document, "div", "dse-coins");
  for (const coin of ["cp", "sp", "ep", "gp", "pp"]) {
    const field = el(document, "label", ""); field.append(el(document, "span", "", coin.toUpperCase()), number(view, coin.toUpperCase(), state.currency[coin] ?? 0, (draft, value) => { draft.currency[coin] = Math.max(0, value); }, 0)); coins.append(field);
  }
  pack.append(coins); return pack;
}

export function combatDetails(view: PlayView): HTMLElement {
  const { document, state, save, editable } = view, computed = savedComputed(state);
  const body = el(document, "div", "dse-combat");
  const attacks = section(document, "Attacks");
  for (const weapon of rows(computed["weapons"])) {
    const row = el(document, "div", "dse-attack"); row.append(el(document, "strong", "", String(weapon["name"] ?? weapon["ref"] ?? "Weapon")), el(document, "span", "", signed(numeric(weapon["attackBonus"], 0))), el(document, "span", "", String(weapon["damage"] ?? ""))); attacks.append(row);
  }
  if (rows(computed["weapons"]).length === 0) attacks.append(el(document, "p", "dse-empty", "No saved attacks. Ready your equipment and recalculate with a rules provider."));
  body.append(attacks);
  const resources = section(document, "Resources");
  for (const resource of rows(computed["resources"])) {
    const key = resource["key"]; if (typeof key !== "string") continue;
    const max = numeric(resource["max"], 0), name = String(resource["name"] ?? key);
    const row = el(document, "div", "dse-resource"); row.append(el(document, "span", "", name));
    const change = (draft: SheetState, delta: number): void => { draft.resourceUses[key] = Math.min(max, Math.max(0, numeric(draft.resourceUses[key], max) + delta)); };
    row.append(button(document, "−", () => save(draft => change(draft, -1)), !editable, `Use ${name}`), number(view, name, numeric(state.resourceUses[key], max), (draft, value) => { draft.resourceUses[key] = Math.max(0, Math.min(max, value)); }, 0, max), el(document, "span", "", `/ ${max}`), button(document, "↺", () => save(draft => { draft.resourceUses[key] = max; }), !editable, `Reset ${name}`)); resources.append(row);
  }
  for (const resource of state.resources) {
    const row = el(document, "div", "dse-resource"); row.append(el(document, "span", "", resource.name));
    const update = (draft: SheetState, delta: number): void => { const target = draft.resources.find(item => item.id === resource.id); if (target) target.current = Math.max(0, Math.min(target.max, target.current + delta)); };
    row.append(button(document, "−", () => save(draft => update(draft, -1)), !editable, `Use ${resource.name}`), number(view, resource.name, resource.current, (draft, value) => { const target = draft.resources.find(item => item.id === resource.id); if (target) target.current = value; }, 0, resource.max), el(document, "span", "", `/ ${resource.max}`), button(document, "+", () => save(draft => update(draft, 1)), !editable, `Recover ${resource.name}`)); resources.append(row);
  }
  if (resources.children.length === 1) resources.append(el(document, "p", "dse-empty", "No resources yet. Add a manual resource in Settings or recalculate a build."));
  body.append(resources);
  const traits = section(document, "Traits & proficiencies");
  const values = { ...state.traitSnapshot, ...computed };
  for (const key of ["languages", "resistances", "damageImmunities", "conditionImmunities"]) {
    const entries = values[key]; if (Array.isArray(entries) && entries.length > 0) traits.append(el(document, "p", "", `${label(key)}: ${entries.filter(entry => typeof entry === "string").join(", ")}`));
  }
  const profs = record(computed["proficiencies"]);
  for (const key of ["armor", "weapons", "tools"]) {
    const entries = profs[key] ?? state.traitSnapshot[key]; if (Array.isArray(entries) && entries.length > 0) traits.append(el(document, "p", "", `${label(key)}: ${entries.join(", ")}`));
  }
  if (traits.children.length > 1) body.append(traits);
  return body;
}

export function el<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K, className = "", text?: string): HTMLElementTagNameMap[K] { const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element; }
export function button(document: Document, text: string, action: () => void, disabled = false, accessibleLabel?: string): HTMLButtonElement { const element = el(document, "button", "", text); element.type = "button"; element.disabled = disabled; if (accessibleLabel) { element.setAttribute("aria-label", accessibleLabel); element.title = accessibleLabel; } element.addEventListener("click", action); return element; }
function number(view: PlayView, name: string, value: number, change: (draft: SheetState, value: number) => void, min?: number, max?: number): HTMLElement {
  if (!view.editable) return el(view.document, "span", "dse-number", String(value));
  const input = el(view.document, "input", "dse-number"); input.type = "number"; input.value = String(value); input.setAttribute("aria-label", name);
  if (min !== undefined) input.min = String(min); if (max !== undefined) input.max = String(max);
  input.addEventListener("change", () => { if (Number.isFinite(input.valueAsNumber)) view.save(draft => change(draft, input.valueAsNumber)); }); return input;
}
function section(document: Document, name: string): HTMLElement { const result = el(document, "section", "dse-section"); result.append(el(document, "h3", "", name)); return result; }
function icon(document: Document, path: string): SVGElement { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); const shape = document.createElementNS(svg.namespaceURI, "path"); shape.setAttribute("d", path); svg.append(shape); return svg; }
function label(value: string): string { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, character => character.toUpperCase()); }
function record(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function rows(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(record) : []; }
function numeric(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function proficiency(values: Record<string, boolean>, key: string): boolean { return (values[aliases[key] ?? key] ?? values[key]) === true; }
function passive(state: SheetState): number { return 10 + abilityModifier(state.abilities.WIS) + (proficiency(state.skillExpertise, "perception") ? 2 : proficiency(state.skillProf, "perception") ? 1 : 0) * state.profBonus; }
