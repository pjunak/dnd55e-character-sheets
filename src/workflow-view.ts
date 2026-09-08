import type { BuilderPlan, PlayChange, RuleRecord } from "./engine-client.js";
import { button, el, savedComputed, type PlayView } from "./play-view.js";
import { abilities, createId, type SheetState } from "./sheet-state.js";

export const equipmentKinds = ["weapon", "armor", "gear", "tool", "magic-item", "pack"] as const;
const categoryNames: Record<string, string> = { weapon: "Weapons", armor: "Armor", gear: "Adventuring gear", tool: "Tools", "magic-item": "Magic items", pack: "Equipment packs" };
const facetFields: Record<string, string> = { weapon: "category", armor: "armorType", tool: "type", "magic-item": "rarity" };
export function record(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function rows(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(record) : []; }
function label(value: unknown): string { return String(value ?? "").replaceAll(/[-_]/g, " "); }
function option(document: Document, value: string, name: string): HTMLOptionElement { const item = el(document, "option", "", name); item.value = value; return item; }

export function equipmentPicker(document: Document, catalog: readonly RuleRecord[], unavailable: boolean, dirty: (value: boolean) => void, commit: (items: SheetState["inventory"]) => void): HTMLElement {
  const root = el(document, "div", "dnd-equipment-picker");
  const controls = el(document, "div", "dnd-workflow-controls");
  const category = el(document, "select", ""); category.setAttribute("aria-label", "Equipment category");
  category.append(option(document, "", "All equipment")); for (const kind of equipmentKinds) category.append(option(document, kind, categoryNames[kind]!));
  const facet = el(document, "select", ""); facet.setAttribute("aria-label", "Equipment group");
  const search = el(document, "input", ""); search.type = "search"; search.placeholder = "Search equipment…"; search.setAttribute("aria-label", "Search equipment");
  controls.append(category, facet, search);
  const split = el(document, "div", "dnd-picker-split"), results = el(document, "div", "dnd-picker-results"), tray = el(document, "section", "dnd-picker-tray");
  const cart: SheetState["inventory"] = [];
  const add = button(document, "Add items to backpack", () => commit(structuredClone(cart)), true);
  const renderTray = (): void => {
    tray.replaceChildren(el(document, "h4", "", `Selected items · ${cart.length}`)); add.disabled = cart.length === 0;
    dirty(cart.length > 0);
    for (const item of cart) {
      const row = el(document, "div", "dnd-picker-row"); row.append(el(document, "span", "", item.name));
      const qty = el(document, "input", ""); qty.type = "number"; qty.min = "1"; qty.max = "5000"; qty.value = String(item.qty); qty.setAttribute("aria-label", `Selected ${item.name} quantity`);
      qty.addEventListener("change", () => { item.qty = Math.min(5000, Math.max(1, Math.trunc(qty.valueAsNumber || 1))); qty.value = String(item.qty); });
      row.append(qty, button(document, "×", () => { cart.splice(cart.indexOf(item), 1); renderTray(); }, false, `Remove selected ${item.name}`)); tray.append(row);
    }
    if (!cart.length) tray.append(el(document, "p", "dse-empty", "Choose items, then add the whole selection together."));
  };
  const stage = (source: RuleRecord | undefined, name: string): void => {
    const existing = source && cart.find(item => item["ref"] === source.id && item["kind"] === source.kind);
    if (existing) existing.qty = Math.min(5000, existing.qty + 1);
    else cart.push({ id: createId("item"), name, qty: 1, location: "pack", notes: "", ...(source ? { kind: source.kind, ref: source.id, snapshot: structuredClone(source) } : {}) });
    renderTray();
  };
  const renderResults = (): void => {
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = catalog.filter(item => (!category.value || item.kind === category.value) && (!facet.value || String(item[facetFields[category.value]!]) === facet.value) && `${item.name ?? item.id} ${item.kind}`.toLocaleLowerCase().includes(query));
    results.replaceChildren(el(document, "p", "dse-empty", `${filtered.length} items${filtered.length > 80 ? " · Refine your search to see more" : ""}`));
    for (const item of filtered.slice(0, 80)) {
      const row = el(document, "div", "dnd-picker-row");
      const details = el(document, "details", ""); details.append(el(document, "summary", "", item.name ?? item.id));
      details.append(el(document, "p", "dse-empty", [categoryNames[item.kind], item["damage"], item["armorType"], item["rarity"], item["weight"] ? `Weight ${String(item["weight"])}` : ""].filter(Boolean).join(" · ")));
      if (typeof item["text"] === "string") details.append(el(document, "p", "", item["text"]));
      row.append(details, button(document, "＋", () => stage(item, item.name ?? item.id), false, `Select ${item.name ?? item.id}`)); results.append(row);
    }
  };
  const renderFacets = (): void => {
    facet.replaceChildren(option(document, "", "All groups"));
    const field = facetFields[category.value];
    if (field) for (const value of [...new Set(catalog.filter(item => item.kind === category.value).map(item => item[field]).filter((value): value is string => typeof value === "string" && value.length > 0))].sort()) facet.append(option(document, value, label(value)));
    facet.disabled = facet.options.length === 1; renderResults();
  };
  category.addEventListener("change", renderFacets); facet.addEventListener("change", renderResults); search.addEventListener("input", renderResults);
  const custom = el(document, "form", "dnd-workflow-controls"); const name = el(document, "input", ""); name.required = true; name.maxLength = 200; name.placeholder = "Custom item name"; name.setAttribute("aria-label", "Custom item name");
  const customAdd = button(document, "Select custom item", () => {}); customAdd.type = "submit";
  custom.addEventListener("submit", event => { event.preventDefault(); if (name.value.trim()) { stage(undefined, name.value.trim()); name.value = ""; } }); custom.append(name, customAdd);
  if (unavailable) root.append(el(document, "p", "dse-empty", "The equipment catalog is unavailable. You can still add custom items."));
  split.append(results, tray); root.append(controls, split, custom, add); renderFacets(); renderTray(); return root;
}

export function restControls(view: PlayView, available: boolean, change: (value: PlayChange, review?: boolean) => void): HTMLElement {
  const { document, state, editable } = view, computed = savedComputed(state);
  const controls = el(document, "section", "dse-section dnd-rest-controls");
  controls.append(el(document, "h3", "", "Rest & features"));
  const buttons = el(document, "div", "dnd-workflow-controls");
  for (const rest of ["short", "long"] as const) buttons.append(button(document, rest === "short" ? "Short rest" : "Long rest", () => change({ operation: "rest", rest }, true), !editable || !available));
  controls.append(buttons);
  for (const resource of rows(computed["resources"]).filter(item => item["kind"] === "hitdice")) {
    const key = String(resource["key"]), max = Number(resource["max"]), current = Number(state.resourceUses[key] ?? max);
    controls.append(button(document, `Spend ${String(resource["die"])} hit die (${current}/${max})`, () => change({ operation: "spend-hit-die", key }, true), !editable || !available || current <= 0));
  }
  for (const activation of rows(computed["activations"])) {
    const key = String(activation["key"]), enabled = state.activeFeatures[key] === true;
    const toggle = button(document, `${enabled ? "End" : "Activate"} ${String(activation["name"])}`, () => change({ operation: "toggle-feature", key, enabled: !enabled }), !editable || !available || !enabled && activation["available"] !== true);
    toggle.setAttribute("aria-pressed", String(enabled)); controls.append(toggle);
  }
  if (!available) controls.append(el(document, "p", "dse-empty", "Connect a rules engine to calculate rests. HP and resource counters remain editable."));
  return controls;
}

export function playReview(document: Document, before: SheetState, after: SheetState): HTMLElement {
  const review = el(document, "div", "dnd-play-review");
  review.append(el(document, "p", "", `Hit points: ${before.hp} → ${after.hp} / ${after.maxHp}`), el(document, "p", "", `Temporary HP: ${before.tempHp} → ${after.tempHp}`));
  for (const resource of rows(savedComputed(after)["resources"])) {
    const key = String(resource["key"]), max = Number(resource["max"]), previous = Number(before.resourceUses[key] ?? max), next = Number(after.resourceUses[key] ?? max);
    if (previous !== next) review.append(el(document, "p", "", `${String(resource["name"])}: ${previous} → ${next} / ${max}`));
  }
  const ended = Object.keys(before.activeFeatures).filter(key => before.activeFeatures[key] && !after.activeFeatures[key]);
  if (ended.length) review.append(el(document, "p", "", `Active features ended: ${ended.length}`));
  return review;
}

export interface SpellBrowserState { classId: string; query: string; level: string; }
export function spellBrowser(view: PlayView, catalog: readonly RuleRecord[], computed: Record<string, unknown>, browser: SpellBrowserState, change: (value: PlayChange) => void): HTMLElement {
  const { document, state, editable } = view;
  const root = el(document, "section", "dnd-spell-browser dse-section"); root.append(el(document, "h3", "", "Manage class spells"));
  const casters = rows(record(computed["spellcasting"])["perClass"]);
  if (!casters.length) { root.append(el(document, "p", "dse-empty", "Choose a spellcasting class in Builder first.")); return root; }
  if (!casters.some(caster => caster["classId"] === browser.classId)) browser.classId = String(casters[0]!["classId"]);
  const classSelect = el(document, "select", ""); classSelect.setAttribute("aria-label", "Spellcasting class");
  for (const caster of casters) classSelect.append(option(document, String(caster["classId"]), label(caster["classId"]))); classSelect.value = browser.classId;
  const search = el(document, "input", ""); search.type = "search"; search.placeholder = "Search spells…"; search.setAttribute("aria-label", "Search spells"); search.value = browser.query;
  const level = el(document, "select", ""); level.setAttribute("aria-label", "Spell level"); level.append(option(document, "", "All levels")); for (let i = 0; i <= 9; i++) level.append(option(document, String(i), i === 0 ? "Cantrips" : `Level ${i}`)); level.value = browser.level;
  const controls = el(document, "div", "dnd-workflow-controls"); controls.append(classSelect, search, level);
  const summary = el(document, "p", "dnd-spell-counts"), results = el(document, "div", "dnd-spell-results");
  const render = (): void => {
    const caster = casters.find(item => item["classId"] === browser.classId)!;
    const classID = browser.classId, isBook = caster["prepares"] === "spellbook";
    summary.textContent = `Cantrips ${(state.cantrips[classID] ?? []).length}/${String(caster["cantripsKnown"])} · Prepared ${(state.preparedSpells[classID] ?? []).length}/${String(caster["preparedLimit"])}${isBook ? ` · Spellbook ${(state.spellbook[classID] ?? []).length} (${String(caster["spellbookKnown"])} from class levels)` : ""}`;
    const selected = new Set([...(state.cantrips[classID] ?? []), ...(state.preparedSpells[classID] ?? []), ...(state.spellbook[classID] ?? [])]);
    const candidates = catalog.filter(spell => selected.has(spell.id) || (Number(spell["level"]) <= Number(caster["maxSpellLevel"]) && (Array.isArray(spell["classes"]) && spell["classes"].includes(caster["spellListClassId"]) || Array.isArray(caster["expandedSpellIds"]) && caster["expandedSpellIds"].includes(spell.id))));
    for (const ref of selected) if (!candidates.some(spell => spell.id === ref)) candidates.push({ kind: "spell", id: ref, name: ref, unavailable: true });
    const filtered = candidates.filter(spell => (!browser.level || String(spell["level"]) === browser.level) && (spell.name ?? spell.id).toLocaleLowerCase().includes(browser.query.toLocaleLowerCase())).sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || Number(a["level"] ?? 0) - Number(b["level"] ?? 0) || (a.name ?? a.id).localeCompare(b.name ?? b.id));
    results.replaceChildren(el(document, "p", "dse-empty", `${filtered.length} spells${filtered.length > 80 ? " · Refine your search to see more" : ""}`));
    for (const spell of filtered.slice(0, 80)) {
      const row = el(document, "article", "dnd-spell-row"); row.dataset["spell"] = spell.id;
      const details = el(document, "details", ""); details.append(el(document, "summary", "", `${spell.name ?? spell.id} · ${Number(spell["level"]) === 0 ? "Cantrip" : `Level ${String(spell["level"] ?? "?")}`} ${label(spell["school"])}`));
      details.append(el(document, "p", "", typeof spell["text"] === "string" ? spell["text"] : "No description available.")); row.append(details);
      const actions = el(document, "div", "dnd-workflow-controls");
      const choose = (selection: "cantrips" | "spellbook" | "preparedSpells", on: string, off: string): void => {
        const chosen = (state[selection][classID] ?? []).includes(spell.id);
        actions.append(button(document, chosen ? off : on, () => change({ operation: "select-spell", classId: classID, ref: spell.id, selection, selected: !chosen }), !editable || !chosen && spell["unavailable"] === true));
      };
      if (Number(spell["level"]) === 0 || (state.cantrips[classID] ?? []).includes(spell.id)) choose("cantrips", "Learn cantrip", "Forget cantrip");
      else {
        if (isBook) choose("spellbook", "Learn spell", "Forget spell");
        choose("preparedSpells", "Prepare", "Unprepare");
      }
      const castable = (state.cantrips[classID] ?? []).includes(spell.id) || (state.preparedSpells[classID] ?? []).includes(spell.id);
      if (castable && spell["unavailable"] !== true) {
        const slots = el(document, "select", ""); slots.setAttribute("aria-label", `Casting slot for ${spell.name ?? spell.id}`);
        if (Number(spell["level"]) === 0) slots.append(option(document, "", "No slot needed"));
        else for (const resource of rows(computed["resources"]).filter(item => item["kind"] === "slot")) {
          const key = String(resource["key"]), maximum = Number(resource["max"]), remaining = Number(state.resourceUses[key] ?? maximum);
          slots.append(option(document, key, `${String(resource["name"])} · ${remaining}/${maximum}`));
        }
        actions.append(slots, button(document, "Cast", () => change({ operation: "cast-spell", classId: classID, ref: spell.id, slot: slots.value }), !editable || slots.options.length === 0));
      }
      row.append(actions); results.append(row);
    }
  };
  classSelect.addEventListener("change", () => { browser.classId = classSelect.value; render(); }); search.addEventListener("input", () => { browser.query = search.value; render(); }); level.addEventListener("change", () => { browser.level = level.value; render(); });
  root.append(controls, summary, results); render(); return root;
}

export function foundationEditor(view: PlayView, plan: BuilderPlan, species: readonly RuleRecord[], backgrounds: readonly RuleRecord[], update: (change: (draft: SheetState) => void) => void): HTMLElement {
  const { document, state, editable } = view;
  const root = el(document, "section", "dnd-builder-foundation"); root.append(el(document, "h4", "", "Foundation"));
  const fields = el(document, "div", "dnd-sheet-form-grid");
  for (const [field, title, catalog] of [["species", "Species", species], ["background", "Background", backgrounds]] as const) {
    const wrapper = el(document, "label", "dnd-sheet-field", title), select = el(document, "select", ""); select.setAttribute("aria-label", title); select.disabled = !editable; select.append(option(document, "", `Choose ${title.toLowerCase()}…`));
    for (const item of catalog) select.append(option(document, item.name ?? item.id, item.name ?? item.id));
    const stored = field === "species" ? state.species || state.race : state.background;
    const known = catalog.find(item => item.id === stored || item.name === stored);
    if (stored && !known) select.append(option(document, stored, `${stored} (saved)`)); select.value = known?.name ?? stored;
    select.addEventListener("change", () => update(draft => { draft[field] = select.value; if (field === "species") { draft.race = select.value; draft.lineage = ""; } })); wrapper.append(select); fields.append(wrapper);
  }
  const selectedSpecies = species.find(item => item.name === (state.species || state.race) || item.id === (state.species || state.race));
  const lineages = rows(selectedSpecies?.["lineages"]);
  if (lineages.length || state.lineage) {
    const wrapper = el(document, "label", "dnd-sheet-field", "Lineage"), select = el(document, "select", ""); select.setAttribute("aria-label", "Lineage"); select.disabled = !editable;
    select.append(option(document, "", "Choose lineage…")); for (const item of lineages) select.append(option(document, String(item["id"]), String(item["name"] ?? item["id"])));
    if (state.lineage && !lineages.some(item => item["id"] === state.lineage)) select.append(option(document, state.lineage, `${state.lineage} (saved)`)); select.value = state.lineage;
    select.addEventListener("change", () => update(draft => { draft.lineage = select.value; })); wrapper.append(select); fields.append(wrapper);
  }
  const policy = record(plan["pointBuy"]), range = record(state.manualScores ? plan["abilityScoreRange"] : policy);
  const manualLabel = el(document, "label", "dnd-sheet-field", "Rolled / manual scores"), manual = el(document, "input", ""); manual.type = "checkbox"; manual.checked = state.manualScores; manual.disabled = !editable;
  manual.addEventListener("change", () => update(draft => { draft.manualScores = manual.checked; })); manualLabel.append(manual); fields.append(manualLabel);
  const scores = state.baseStats ?? state.abilities;
  for (const ability of abilities) {
    const wrapper = el(document, "label", "dnd-sheet-field", `Base ${ability}`), input = el(document, "input", ""); input.type = "number"; input.value = String(scores[ability]); input.min = String(range["min"]); input.max = String(range["max"]); input.disabled = !editable;
    input.addEventListener("change", () => { if (!input.reportValidity() || !Number.isInteger(input.valueAsNumber)) return; const value = input.valueAsNumber; update(draft => { draft.baseStats ??= { ...draft.abilities }; draft.baseStats[ability] = value; }); }); wrapper.append(input); fields.append(wrapper);
  }
  root.append(fields);
  if (!state.manualScores) {
    const cost = record(policy["cost"]), costs = abilities.map(ability => Number(cost[String(scores[ability])]));
    const spent = costs.reduce((sum, value) => sum + value, 0);
    root.append(el(document, "p", "dnd-builder-progress", costs.every(Number.isFinite) ? `Point buy: ${spent} / ${String(policy["budget"])} · ${Number(policy["budget"]) - spent} remaining` : "Some base scores are outside the point-buy range. Choose manual scores or adjust them."));
  }
  return root;
}
