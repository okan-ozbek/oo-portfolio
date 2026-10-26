import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { emitKeypressEvents } from "node:readline";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hashPassword } from "../server/security.mjs";

export async function setupLocalAdmin() {
  const envFile = new URL("../.env.admin", import.meta.url);
  if (existsSync(envFile)) return;
  if (existsSync(new URL("../.admin-local-password", import.meta.url))) {
    throw new Error("A local password file already exists without .env.admin. Remove both files to regenerate local credentials.");
  }
  const password = randomBytes(24).toString("base64url");
  const hash = await hashPassword(password);
  writeFileSync(envFile, `ADMIN_PASSWORD_HASH=${hash}\n`, { mode: 0o600, flag: "wx" });
  writeFileSync(new URL("../.admin-local-password", import.meta.url), `${password}\n`, { mode: 0o600, flag: "wx" });
  console.log("Local admin configured. Your generated password is in .admin-local-password (ignored by Git and Docker).");
}

async function promptPassword() {
  if (!process.stdin.isTTY) {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    return input.replace(/\r?\n$/, "");
  }
  process.stderr.write("New admin password (16–256 characters, input hidden): ");
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let password = "";
    function finish(error) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("keypress", onKey);
      process.stderr.write("\n");
      if (error) reject(error); else resolve(password);
    }
    function onKey(text, key) {
      if (key?.ctrl && key.name === "c") return finish(new Error("Cancelled."));
      if (key?.name === "return") return finish();
      if (key?.name === "backspace") password = password.slice(0, -1);
      else if (text && !key?.ctrl && !key?.meta && !/[\r\n\x00-\x1f\x7f]/.test(text)) password += text;
    }
    process.stdin.on("keypress", onKey);
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.includes("--local")) await setupLocalAdmin();
    else console.log(await hashPassword(await promptPassword()));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
