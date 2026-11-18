// Drives the /__bench endpoints on a deployed Worker so CPU time can be read from Workers Logs.
//   node scripts/bench-remote.mjs https://openpurr.<you>.workers.dev <BENCH_TOKEN> [rounds=30]
// Then in the dashboard: Workers > openpurr > Observability, filter on the `bench` field and
// chart $workers.cpuTimeMs (p50/p99) grouped by `bench`. Divide by n where n > 1.

const [base, token, rounds = "30"] = process.argv.slice(2);
if (!base || !token) {
  console.error("usage: node scripts/bench-remote.mjs <worker-url> <bench-token> [rounds]");
  process.exit(1);
}
const get = (path) => fetch(base + path, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());

const { ops } = await get("/__bench");
console.log("rate limiter:", await get("/__bench/ratelimit"));
console.log("pbkdf2 600k:", await get("/__bench/pbkdf2?iter=600000"));

const started = new Date().toISOString();
for (let i = 0; i < Number(rounds); i++) {
  for (const op of ops) {
    const res = await get(`/__bench/${op}`);
    if (!res.ok) console.error(op, res.error);
  }
}
console.log(`ran ${rounds} rounds of ${ops.length} ops between ${started} and ${new Date().toISOString()}`);
