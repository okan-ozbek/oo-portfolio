import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { setupLocalAdmin } from "./admin-password.mjs";
import { createAdminServer } from "../server/admin-server.mjs";

const { values } = parseArgs({ options: { host: { type: "string" }, port: { type: "string" }, strictPort: { type: "boolean" } } });
const host = values.host ?? "127.0.0.1";
if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("The draft dev server must bind to loopback. Use the HTTPS Docker deployment for remote access.");
await setupLocalAdmin();
loadEnvFile(new URL("../.env.admin", import.meta.url));
const adminPort = Number(process.env.ADMIN_PORT ?? 3031);
process.env.PIXELWARE_ADMIN_TARGET = `http://127.0.0.1:${adminPort}`;
const vite = await createServer({ server: { host, ...(values.port ? { port: Number(values.port) } : {}), strictPort: values.strictPort } });
let admin;
try {
  await vite.listen();
  const origin = new URL(vite.resolvedUrls.local[0]).origin;
  admin = createAdminServer({ passwordHash: process.env.ADMIN_PASSWORD_HASH, origin, databasePath: fileURLToPath(new URL("../data/admin.sqlite", import.meta.url)), secureCookies: false });
  await new Promise((resolve, reject) => { admin.once("error", reject); admin.listen(adminPort, "127.0.0.1", resolve); });
  vite.printUrls();
  console.log(`  Admin: ${origin}/admin`);
} catch (error) {
  await vite.close();
  if (admin?.listening) admin.close();
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  await vite.close();
  admin.close();
});
