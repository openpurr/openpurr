// Records the home page's savings calculator (src/components/SavingsCalculator.astro) as the
// README's animation: .github/assets/openpurr-savings.webp and -dark.webp. The slider sweeps up the
// revenue range, rests, and comes back.
//
//   pnpm build && (cd dist && python3 -m http.server 4329 &) && node scripts/record-savings.mjs http://127.0.0.1:4329/
//
// Needs Google Chrome (or CHROME=<path>) and img2webp (brew install webp), like record-demo.mjs.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] ?? "http://127.0.0.1:4329/";
const ASSETS = new URL("../../.github/assets/", import.meta.url).pathname;

async function record(THEME, OUT) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const chrome = spawn(process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, "--hide-scrollbars", `--user-data-dir=/tmp/cdp-rec-${Date.now()}`, "about:blank"], { stdio: "ignore" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let tabs;
    for (let i = 0; i < 50 && !tabs; i++) { await sleep(300); tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null); }
    const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
    let id = 0; const pend = {};
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend[m.id]) { pend[m.id](m.result); delete pend[m.id]; } };
    await new Promise((r) => (ws.onopen = r));
    const send = (method, params = {}) => new Promise((r) => { pend[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
    const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: `(async () => JSON.stringify(await (async () => { ${expr} })()))()`, awaitPromise: true, returnByValue: true }); if (r?.exceptionDetails || typeof r?.result?.value !== "string") throw new Error(`evaluate failed: ${JSON.stringify(r).slice(0, 400)}`); return JSON.parse(r.result.value); };

    // Reduced motion: the yearly figure jumps to each value, so every frame is exact.
    await send("Emulation.setDeviceMetricsOverride", { width: 1240, height: 900, deviceScaleFactor: 1.5, mobile: false });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: THEME }, { name: "prefers-reduced-motion", value: "reduce" }] });
    await send("Page.navigate", { url: URL_ });
    await sleep(1800);
    // Only the slider, figures and chart: the table and method notes are hidden for the recording.
    const box = await ev(`
      const st = document.createElement('style');
      st.textContent = '#savings details{display:none}';
      document.head.append(st);
      const el = document.querySelector('#savings .calc');
      el.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 300));
      const r = el.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height }`);
    const clip = { x: box.x - 1, y: box.y - 1, width: box.w + 2, height: box.h + 2, scale: 1 };

    let n = 0;
    const frames = [];
    const frame = async (ms) => {
      await sleep(40);
      const r = await send("Page.captureScreenshot", { format: "png", clip });
      const file = `frame-${String(n++).padStart(3, "0")}.png`;
      writeFileSync(`${OUT}/${file}`, Buffer.from(r.data, "base64"));
      frames.push([file, ms]);
    };
    const set = (v) => ev(`const i = document.querySelector('#savings input[type=range]'); i.value = '${Math.round(v)}'; i.dispatchEvent(new Event('input')); return 1`);
    const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    const sweep = async (from, to, steps, ms) => {
      for (let i = 1; i <= steps; i++) { await set(from + (to - from) * ease(i / steps)); await frame(ms); }
    };

    // From $2,000 (slider ~250) up to $250,000 (1000), rest, back to $25,000 (~630), rest.
    await set(250); await frame(900);
    await sweep(250, 1000, 36, 50);
    await frame(1800);
    await sweep(1000, 630, 20, 50);
    await frame(2600);
    ws.close();
    return frames;
  } finally {
    chrome.kill();
  }
}

for (const theme of ["light", "dark"]) {
  const dir = mkdtempSync(join(tmpdir(), `openpurr-savings-${theme}-`));
  const frames = await record(theme, dir);
  const args = ["-loop", "0", "-lossy", "-q", "72", "-m", "6"];
  for (const [file, ms] of frames) args.push("-d", String(ms), join(dir, file));
  const out = join(ASSETS, `openpurr-savings${theme === "dark" ? "-dark" : ""}.webp`);
  execFileSync("img2webp", [...args, "-o", out], { stdio: "inherit" });
}
