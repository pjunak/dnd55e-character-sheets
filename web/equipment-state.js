const bodyArmor = new Set(["light", "medium", "heavy"]);
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}; }
export function inventoryRecord(item, catalog) {
    const exact = catalog.find(value => value.id === item["ref"] && (!item["kind"] || value.kind === item["kind"]));
    if (exact)
        return exact;
    const snapshot = record(item["snapshot"]);
    if (Object.keys(snapshot).length)
        return snapshot;
    const named = catalog.filter(value => value.name === item.name);
    return named.length === 1 ? named[0] : {};
}
export function equipmentSlot(item, catalog) {
    if (item["attuned"])
        return "attuned";
    const armor = inventoryRecord(item, catalog)["armorType"];
    return armor === "shield" ? "shield" : typeof armor === "string" && bodyArmor.has(armor) ? "armor" : "worn";
}
export function equipmentCandidates(state, slot, catalog) {
    return state.inventory.filter(item => {
        if (item.qty <= 0 || item["attuned"])
            return false;
        if (slot === "attuned") {
            const source = inventoryRecord(item, catalog);
            return item["kind"] === "magic-item" && (source["attunement"] === true || !Object.keys(source).length);
        }
        return item.location !== "equipped" && (slot === "worn" || equipmentSlot(item, catalog) === slot);
    });
}
export function equipInventory(state, id, slot, catalog) {
    const target = equipmentCandidates(state, slot, catalog).find(item => item.id === id);
    if (!target)
        return;
    if (slot === "attuned") {
        target["attuned"] = true;
        return;
    }
    if (slot === "armor" || slot === "shield")
        for (const item of state.inventory) {
            if (item.location === "equipped" && equipmentSlot(item, catalog) === slot)
                item.location = "pack";
        }
    const source = inventoryRecord(target, catalog);
    if (Object.keys(source).length)
        target["snapshot"] = structuredClone(source);
    target.location = "equipped";
}
