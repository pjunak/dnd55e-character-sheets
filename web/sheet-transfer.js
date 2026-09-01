import { normalizeSheet } from "./sheet-state.js";
export const transferFormat = "ttrpg-codex.dnd-sheet";
export const transferVersion = 1;
const maximumBytes = 1024 * 1024;
export function serializeSheet(sheet) {
    return JSON.stringify({ format: transferFormat, version: transferVersion, sheet }, null, 2);
}
export function parseSheet(text) {
    if (new TextEncoder().encode(text).byteLength > maximumBytes)
        throw new Error("The sheet file is larger than 1 MiB.");
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        throw new Error("The sheet file is not valid JSON.");
    }
    const root = asRecord(value);
    if (root["format"] === undefined)
        return normalizeSheet(assertSafeTree(root));
    if (root["format"] !== transferFormat || root["version"] !== transferVersion)
        throw new Error("This sheet export format is not supported.");
    return normalizeSheet(assertSafeTree(asRecord(root["sheet"])));
}
function assertSafeTree(value) {
    let nodes = 0;
    const visit = (item, depth) => {
        nodes += 1;
        if (nodes > 20_000 || depth > 16)
            throw new Error("The sheet file is too deeply nested or complex.");
        if (item === null || typeof item === "string" || typeof item === "boolean")
            return;
        if (typeof item === "number") {
            if (!Number.isFinite(item))
                throw new Error("The sheet contains an invalid number.");
            return;
        }
        if (Array.isArray(item)) {
            for (const child of item)
                visit(child, depth + 1);
            return;
        }
        if (typeof item !== "object")
            throw new Error("The sheet contains an unsupported value.");
        for (const [key, child] of Object.entries(item)) {
            if (key === "__proto__" || key === "prototype" || key === "constructor")
                throw new Error("The sheet contains an unsafe field.");
            visit(child, depth + 1);
        }
    };
    visit(value, 0);
    return value;
}
function asRecord(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error("The sheet file must contain an object.");
    return value;
}
