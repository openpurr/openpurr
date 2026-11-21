// Records the home page's dashboard demo (src/components/DashboardDemo.astro) as the README's
// animation: .github/assets/openpurr-dashboard-demo.webp and -dark.webp.
//
//   pnpm build && (cd dist && python3 -m http.server 4329 &) && node scripts/record-demo.mjs http://127.0.0.1:4329/
//
// Needs Google Chrome (or CHROME=<path>) and img2webp (brew install webp). Drives headless Chrome,
// draws a cursor (it draws none of its own), clicks through the charts and sweeps the tooltips,
// captures each frame, then encodes an animated WebP per color scheme with exact frame durations.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] ?? "http://127.0.0.1:4329/";
const ASSETS = new URL("../../.github/assets/", import.meta.url).pathname;

async function record(THEME, OUT) {
  // A port of its own each run, and Chrome is closed however the script ends.
  const port = 9400 + Math.floor(Math.random() * 500);
  const chrome = spawn(process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, "--hide-scrollbars", `--user-data-dir=/tmp/cdp-rec-${Date.now()}`, "about:blank"], { stdio: "ignore" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let tabs;
  for (let i = 0; i < 50 && !tabs; i++) { await sleep(300); tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null); }
  process.once("exit", () => chrome.kill());
  const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  let id = 0; const pend = {};
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend[m.id]) { pend[m.id](m.result); delete pend[m.id]; } };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { pend[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: `(async () => JSON.stringify(await (async () => { ${expr} })()))()`, awaitPromise: true, returnByValue: true }); if (r?.exceptionDetails || typeof r?.result?.value !== "string") throw new Error(`evaluate failed: ${JSON.stringify(r).slice(0, 400)}`); return JSON.parse(r.result.value); };

  const SCALE = 1.5;
  await send("Emulation.setDeviceMetricsOverride", { width: 1240, height: 900, deviceScaleFactor: SCALE, mobile: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: THEME }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await send("Page.navigate", { url: URL_ });
  await sleep(1800);
  // Flat (no scroll tilt), centered, and a drawn cursor (headless Chrome draws none).
  await ev(`
    const st = document.createElement('style');
    st.textContent = '.demo-window{animation:none!important;transform:none!important} #rec-cursor{position:fixed;z-index:9999;width:22px;height:22px;pointer-events:none;left:0;top:0;transition:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}';
    document.head.append(st);
    document.querySelector('.demo-window').scrollIntoView({ block: 'center' });
    const c = document.createElement('div'); c.id = 'rec-cursor';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2 L4 19 L8.5 14.8 L11.6 21.4 L14.3 20.2 L11.3 13.7 L17.5 13.6 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.append(c);
    return 1`);
  await sleep(600);
  // Viewport coordinates for the mouse; the screenshot clip is in page coordinates (plus scroll).
  const win = await ev(`const r = document.querySelector('.demo-window').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, sx: scrollX, sy: scrollY }`);
  const pad = 1;
  const clip = { x: win.x + win.sx - pad, y: win.y + win.sy - pad, width: win.w + 2 * pad, height: win.h + 2 * pad, scale: 1 };

  let n = 0;
  const frames = [];
  let cur = { x: win.x + win.w * 0.7, y: win.y + win.h * 0.85 };
  const moveTo = async (x, y) => {
    cur = { x, y };
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await ev(`const c = document.getElementById('rec-cursor'); c.style.left = '${x - 4}px'; c.style.top = '${y - 2}px'; return 1`);
  };
  const frame = async (ms) => {
    await sleep(60);
    const r = await send("Page.captureScreenshot", { format: "png", clip });
    const file = `frame-${String(n++).padStart(3, "0")}.png`;
    writeFileSync(`${OUT}/${file}`, Buffer.from(r.data, "base64"));
    frames.push(`${file} ${ms}`);
  };
  /** Glides the cursor to an element's center over `steps` frames. */
  const glide = async (selector, steps = 6) => {
    const t = await ev(`const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`);
    const from = { ...cur };
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      await moveTo(from.x + (t.x - from.x) * e, from.y + (t.y - from.y) * e);
      await frame(40);
    }
  };
  const click = async (selector) => {
    await glide(selector);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: cur.x, y: cur.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cur.x, y: cur.y, button: "left", clickCount: 1 });
    await sleep(250);
  };
  /** Sweeps across the chart, so the crosshair and tooltip follow. */
  const sweep = async (from = 0.12, to = 0.88, steps = 12) => {
    const r = await ev(`const s = document.querySelector('.chart-svg').getBoundingClientRect(); return { x: s.x, y: s.y, w: s.width, h: s.height }`);
    for (let i = 0; i <= steps; i++) {
      await moveTo(r.x + r.w * (from + ((to - from) * i) / steps), r.y + r.h * 0.45);
      await frame(i === steps ? 1100 : 140);
    }
  };

  await moveTo(cur.x, cur.y);
  await frame(1400); // MRR, 12 months
  await sweep(0.15, 0.95, 10);
  await click('[data-chart="mrr_movement"]');
  await frame(1300);
  await sweep(0.2, 0.9, 9);
  await click('[data-chart="revenue"]');
  await frame(900);
  await click('[data-range="30d"]');
  await frame(1100);
  await sweep(0.1, 0.92, 12);
  await click('[data-range="12m"]');
  await click('[data-chart="active_subscriptions"]');
  await frame(1300);
  await sweep(0.3, 0.95, 8);
  await click('[data-chart="churn"]');
  await frame(1300);
  await sweep(0.2, 0.9, 8);
  await click('[data-chart="mrr"]');
  await frame(600);
  ws.close();
  chrome.kill();
  return frames;
}

for (const theme of ["light", "dark"]) {
  const dir = mkdtempSync(join(tmpdir(), `openpurr-demo-${theme}-`));
  const frames = await record(theme, dir);
  const args = ["-loop", "0", "-lossy", "-q", "72", "-m", "6"];
  for (const f of frames) {
    const [file, ms] = f.split(" ");
    args.push("-d", ms, join(dir, file));
  }
  const out = join(ASSETS, `openpurr-dashboard-demo${theme === "dark" ? "-dark" : ""}.webp`);
  execFileSync("img2webp", [...args, "-o", out], { stdio: "inherit" });
}
