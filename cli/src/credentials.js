// Where the CLI keeps who you are on which deployment: ~/.config/openpurr/credentials.json
// ($XDG_CONFIG_HOME respected), readable only by you. One entry per profile:
//   { "profiles": { "default": { "url": "https://office.example.com", "token": "pat_..." } } }
// OPENPURR_URL and OPENPURR_TOKEN override it (CI, scripts, skills).

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function credentialsPath(env) {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(base, "openpurr", "credentials.json");
}

export function readCredentials(env) {
  const path = credentialsPath(env);
  if (!existsSync(path)) return { profiles: {} };
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data && typeof data.profiles === "object" ? data : { profiles: {} };
  } catch {
    return { profiles: {} };
  }
}

export function writeCredentials(env, data) {
  const path = credentialsPath(env);
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600); // also when the file already existed
}

/** The deployment and token to use: flags, then environment, then the saved profile. */
export function resolveTarget(env, flags) {
  const profile = readCredentials(env).profiles[flags.profile || "default"] ?? {};
  const url = (flags.url || env.OPENPURR_URL || profile.url || "").replace(/\/+$/, "");
  const token = flags.token || env.OPENPURR_TOKEN || profile.token || "";
  return { url, token };
}
