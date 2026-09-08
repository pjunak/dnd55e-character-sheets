import type { RuleRecord } from "./engine-client.js";
import type { InventoryItem, SheetState } from "./sheet-state.js";

export type EquipmentSlot = "armor" | "shield" | "worn" | "attuned";
const bodyArmor = new Set(["light", "medium", "heavy"]);
function record(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function inventoryRecord(item: InventoryItem, catalog: readonly RuleRecord[]): Record<string, unknown> {
  const exact = catalog.find(value => value.id === item["ref"] && (!item["kind"] || value.kind === item["kind"]));
  if (exact) return exact;
  const snapshot = record(item["snapshot"]); if (Object.keys(snapshot).length) return snapshot;
  const named = catalog.filter(value => value.name === item.name); return named.length === 1 ? named[0]! : {};
}
export function equipmentSlot(item: InventoryItem, catalog: readonly RuleRecord[]): EquipmentSlot {
  if (item["attuned"]) return "attuned";
  const armor = inventoryRecord(item, catalog)["armorType"];
  return armor === "shield" ? "shield" : typeof armor === "string" && bodyArmor.has(armor) ? "armor" : "worn";
}
export function equipmentCandidates(state: SheetState, slot: EquipmentSlot, catalog: readonly RuleRecord[]): InventoryItem[] {
  return state.inventory.filter(item => {
    if (item.qty <= 0 || item["attuned"]) return false;
    if (slot === "attuned") { const source = inventoryRecord(item, catalog); return item["kind"] === "magic-item" && (source["attunement"] === true || !Object.keys(source).length); }
    return item.location !== "equipped" && (slot === "worn" || equipmentSlot(item, catalog) === slot);
  });
}
export function equipInventory(state: SheetState, id: string, slot: EquipmentSlot, catalog: readonly RuleRecord[]): void {
  const target = equipmentCandidates(state, slot, catalog).find(item => item.id === id);
  if (!target) return;
  if (slot === "attuned") { target["attuned"] = true; return; }
  if (slot === "armor" || slot === "shield") for (const item of state.inventory) {
    if (item.location === "equipped" && equipmentSlot(item, catalog) === slot) item.location = "pack";
  }
  const source = inventoryRecord(target, catalog); if (Object.keys(source).length) target["snapshot"] = structuredClone(source);
  target.location = "equipped";
}
