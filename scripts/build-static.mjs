import { fileURLToPath } from "node:url";
import { validateStaticExport } from "./validate-static-export.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.env.PIXELWARE_STATIC_EXPORT = "1";
// Use the same build/prerender phases as vinext's CLI, but allow Node to exit
// naturally. Its forced process.exit() crashes libuv on Windows after prerender.
const { createBuilder } = await import("vite");
const builder = await createBuilder({ root });
await builder.buildApp();
// This internal runner belongs to the exact vinext version pinned in our lockfile.
const { runPrerender } = await import(new URL("./build/run-prerender.js", import.meta.resolve("vinext")));
await runPrerender({ root });
await validateStaticExport(new URL("../dist/client/", import.meta.url));
console.log("Static site ready in dist/client/ (validated for NGINX).");
