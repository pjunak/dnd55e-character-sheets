import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(repositoryRoot, "web");
await mkdir(outputDirectory, { recursive: true });
await copyFile(resolve(repositoryRoot, "src", "index.css"), resolve(outputDirectory, "index.css"));
