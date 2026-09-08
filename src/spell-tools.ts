import { sheetTranslator, type SheetTranslator } from "./sheet-catalogs.js";
import type { PlayChange, RuleRecord } from "./engine-client.js";
import { button, el, type PlayView } from "./play-view.js";
import type { SheetState } from "./sheet-state.js";
import { record, rows } from "./workflow-view.js";

export function sourceLabel(value: unknown): string { return String(value ?? "").replaceAll(/[-_]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()); }
function option(document: Document, value: string, title: string): HTMLOptionElement { const node = el(document, "option", "", title); node.value = value; return node; }
export function stringList(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }

export function castingSlots(document: Document, name: string, keys: readonly string[], options: Record<string, unknown>, t: SheetTranslator = sheetTranslator()): HTMLSelectElement {
  const select = el(document, "select", ""); select.setAttribute("aria-label", t("spells.castingSlot", { name }));
  for (const key of keys) {
    const resource = rows(options["slots"]).find(item => item["key"] === key);
    const title = key === "" ? t("spells.noSlot") : `${String(resource?.["name"] ?? key)} · ${String(resource?.["current"] ?? 0)}/${String(resource?.["max"] ?? 0)}`;
    const node = option(document, key, title); node.disabled = key !== "" && Number(resource?.["current"] ?? 0) <= 0; select.append(node);
  }
  select.selectedIndex = [...select.options].findIndex(item => !item.disabled);
  return select;
}

export function grantedSpells(view: PlayView, catalog: readonly RuleRecord[], options: Record<string, unknown>, change: (value: PlayChange) => void): HTMLElement {
  const t = sheetTranslator(view.locale);
  const { document, editable } = view;
  const root = el(document, "section", "dnd-granted-spells dse-section"); root.append(el(document, "h3", "", t("spells.grants")));
  for (const choice of rows(options["castingAbilityChoices"])) {
    const key = String(choice["key"]), name = sourceLabel(record(choice["source"])["id"]);
    const field = el(document, "label", "dnd-sheet-field", t("spells.castingAbility", { name })), select = el(document, "select", "");
    select.setAttribute("aria-label", t("spells.castingAbility", { name })); select.disabled = !editable; select.append(option(document, "", t("builder.chooseAbility")));
    for (const ability of stringList(choice["options"])) select.append(option(document, ability, ability)); select.value = String(choice["selected"] ?? "");
    select.addEventListener("change", () => { if (select.value) change({ operation: "select-casting-ability", key, ability: select.value }); }); field.append(select); root.append(field);
  }
  for (const choice of rows(options["pendingChoices"])) {
    const key = String(choice["key"]), name = sourceLabel(record(choice["source"])["id"]), picked = stringList(choice["picked"]);
    const group = el(document, "fieldset", "dnd-spell-grant-choice"); group.dataset["grant"] = key; group.append(el(document, "legend", "", t("spells.grantCount", { name, picked: picked.length, count: String(choice["choose"]) })));
    for (const ref of picked) group.append(button(document, t("play.remove", { name: catalog.find(item => item.id === ref)?.name ?? ref }), () => change({ operation: "select-grant-spell", key, ref, selected: false }), !editable));
    const controls = el(document, "div", "dnd-workflow-controls"), select = el(document, "select", ""); select.setAttribute("aria-label", t("spells.choice", { key })); select.disabled = !editable;
    for (const ref of stringList(choice["eligibleSpellIds"]).filter(ref => !picked.includes(ref))) select.append(option(document, ref, catalog.find(item => item.id === ref)?.name ?? ref));
    controls.append(select, button(document, t("spells.choose"), () => change({ operation: "select-grant-spell", key, ref: select.value, selected: true }), !editable || !select.options.length || picked.length >= Number(choice["choose"]))); group.append(controls); root.append(group);
  }
  for (const grant of rows(options["granted"])) {
    const key = String(grant["key"]), name = String(grant["name"] ?? grant["ref"]), row = el(document, "article", "dnd-spell-row"); row.dataset["grantedSpell"] = key;
    row.append(el(document, "strong", "", name), el(document, "span", "dse-empty", `${sourceLabel(record(grant["source"])["id"])}${grant["castingAbility"] ? ` · ${String(grant["castingAbility"])}` : ""}${grant["castAtLevel"] ? t("spells.castLevel", { level: String(grant["castAtLevel"]) }) : ""}`));
    const controls = el(document, "div", "dnd-workflow-controls"), select = castingSlots(document, name, stringList(grant["slots"]), options, t);
    select.disabled = !editable;
    controls.append(select, button(document, t("spells.castGranted"), () => change({ operation: "cast-granted-spell", key, slot: select.value }), !editable || select.selectedIndex < 0)); row.append(controls); root.append(row);
  }
  if (root.children.length === 1) root.append(el(document, "p", "dse-empty", t("spells.noGrants")));
  return root;
}

export function copySpellForm(document: Document, state: SheetState, spell: RuleRecord, classId: string, cost: number, submit: (change: PlayChange) => void, t: SheetTranslator = sheetTranslator()): HTMLElement {
  const form = el(document, "form", "dnd-spell-copy dnd-play-review");
  form.append(el(document, "p", "", t("spells.copyCost", { name: spell.name ?? spell.id, class: sourceLabel(classId), cost, gold: state.currency["gp"] ?? 0 })));
  const scroll = el(document, "select", ""); scroll.setAttribute("aria-label", t("spells.consumeScroll")); scroll.append(option(document, "", t("spells.copyBook")));
  const foldedName = (spell.name ?? spell.id).toLocaleLowerCase();
  for (const item of state.inventory) if (item.qty > 0 && (item["spellRef"] === spell.id || item.name.toLocaleLowerCase().includes("scroll") && item.name.toLocaleLowerCase().includes(foldedName))) scroll.append(option(document, item.id, t("spells.scrollCount", { name: item.name, count: item.qty })));
  const apply = button(document, t("spells.reviewCopy"), () => {}, Number(state.currency["gp"] ?? 0) < cost); apply.type = "submit";
  form.addEventListener("submit", event => { event.preventDefault(); submit({ operation: "copy-spell", classId, ref: spell.id, scrollId: scroll.value }); }); form.append(scroll, apply); return form;
}

export function swapSpellForm(document: Document, state: SheetState, classId: string, eligible: readonly string[], catalog: readonly RuleRecord[], submit: (change: PlayChange) => void, t: SheetTranslator = sheetTranslator()): HTMLElement {
  const form = el(document, "form", "dnd-spell-swap dnd-play-review"), selected = state.preparedSpells[classId] ?? [];
  const from = el(document, "select", ""), to = el(document, "select", ""); from.setAttribute("aria-label", t("spells.replace")); to.setAttribute("aria-label", t("spells.replacement"));
  for (const ref of selected) from.append(option(document, ref, catalog.find(item => item.id === ref)?.name ?? ref));
  for (const ref of eligible.filter(ref => !selected.includes(ref) && Number(catalog.find(item => item.id === ref)?.["level"] ?? 0) > 0)) to.append(option(document, ref, catalog.find(item => item.id === ref)?.name ?? ref));
  const apply = button(document, t("spells.reviewSwap"), () => {}, !from.options.length || !to.options.length); apply.type = "submit";
  form.addEventListener("submit", event => { event.preventDefault(); submit({ operation: "swap-spell", classId, out: from.value, ref: to.value }); });
  form.append(el(document, "p", "", t("spells.swapHelp")), from, to, apply); return form;
}

export function spellSwapHistory(view: PlayView, catalog: readonly RuleRecord[]): HTMLElement {
  const t = sheetTranslator(view.locale);
  const { document, state, editable, save } = view, section = el(document, "details", "dnd-spell-history"); section.append(el(document, "summary", "", t("spells.history", { count: state.spellSwaps.length })));
  state.spellSwaps.forEach((swap, index) => {
    const oldName = catalog.find(item => item.id === swap["out"])?.name ?? String(swap["out"]), newName = catalog.find(item => item.id === swap["in"])?.name ?? String(swap["in"]);
    const row = el(document, "div", "dnd-spell-row"); row.append(el(document, "span", "", `${sourceLabel(swap["classId"])} ${String(swap["classLevel"] ?? swap["level"])}: ${oldName} → ${newName}`));
    if (editable) row.append(button(document, t("spells.removeHistory"), () => save(draft => { draft.spellSwaps.splice(index, 1); }))); section.append(row);
  }); return section;
}
