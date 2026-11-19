// Small SVG charts: columns for per-period amounts, lines for values at a point in time.
//
// Mark specs: columns at most 24px wide with a 4px rounded data end (square at the baseline);
// 2px lines with a 10% area wash; 8px markers with a 2px surface ring; hairline gridlines.
// Colors come from CSS variables (--chart-1, --chart-2, ...), so light and dark themes each use
// their own validated steps; the chart redraws when the theme or its width changes. Hover, or
// focus and the arrow keys, show a crosshair and a tooltip with every series' value.

import { h } from "./dom.js";

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  return el;
};

// ---- Number formats -----------------------------------------------------------------------------

const usdFull = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const countFull = new Intl.NumberFormat("en-US");

function compact(n, unit) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const prefix = unit === "usd" ? "$" : "";
  if (abs >= 1e6) return `${sign}${prefix}${trim(abs / 1e6)}M`;
  if (abs >= 1e4) return `${sign}${prefix}${trim(abs / 1e3)}K`;
  return unit === "usd" ? usdWhole.format(n) : countFull.format(n);
}
const trim = (n) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10).toString();

/** A value for display: full precision for money in tooltips, compact for headlines. */
export function formatValue(n, unit, { compact: short = false, whole = false } = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (short) return compact(n, unit);
  if (whole && unit === "usd" && Math.abs(n) >= 1000) return usdWhole.format(n);
  return unit === "usd" ? usdFull.format(n) : countFull.format(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatPeriod(date, interval, { long = false } = {}) {
  const [y, m, d] = date.split("-").map(Number);
  if (interval === "month") return long ? `${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]}${m === 1 ? ` ’${String(y).slice(2)}` : ""}`;
  const label = `${MONTHS[m - 1]} ${d}`;
  if (!long) return label;
  return interval === "week" ? `Week of ${label}, ${y}` : `${label}, ${y}`;
}

// ---- Scales -------------------------------------------------------------------------------------

function niceTicks(min, max, count = 4) {
  if (min === max) max = min + 1;
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => span / s <= count) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

// ---- Rendering ----------------------------------------------------------------------------------

/**
 * Draws a chart into `host` and keeps it up to date with the host's width and the theme.
 * opts: { points: [{date, values}], series: [{key, label}], unit, interval,
 *         form: "column" | "line", height, extra: (point) => [[label, text], ...] }
 */
export function renderChart(host, opts) {
  host.classList.add("chart");
  const tooltip = h("div", { class: "chart-tooltip", hidden: true, role: "status" });
  const plot = h("div", { class: "chart-plot" });
  host.replaceChildren(plot, tooltip);
  let active = null;

  const draw = () => {
    const width = Math.max(plot.clientWidth, 240);
    const height = opts.height ?? 220;
    const style = getComputedStyle(host);
    const color = (i) => style.getPropertyValue(`--chart-${i + 1}`).trim() || "#7050e8";
    const surface = style.getPropertyValue("--app-surface").trim() || "#ffffff";
    const { points, series, unit } = opts;
    const values = points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0));
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
    const yMin = ticks[0];
    const yMax = ticks.at(-1);
    const labelWidth = Math.max(...ticks.map((t) => compact(t, unit).length)) * 7 + 10;
    const m = { top: 10, right: 12, bottom: 26, left: labelWidth };
    const iw = width - m.left - m.right;
    const ih = height - m.top - m.bottom;
    const n = Math.max(points.length, 1);
    const band = iw / n;
    const x = (i) => m.left + band * (i + 0.5);
    const y = (v) => m.top + ih - ((v - yMin) / (yMax - yMin)) * ih;

    const root = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "chart-svg", role: "img", tabindex: 0, "aria-label": opts.label ?? "Chart" });
    // Gridlines and y labels.
    for (const t of ticks) {
      root.append(svg("line", { x1: m.left, x2: width - m.right, y1: y(t), y2: y(t), class: t === 0 ? "chart-baseline" : "chart-gridline" }));
      const label = svg("text", { x: m.left - 8, y: y(t), class: "chart-axis", "text-anchor": "end", "dominant-baseline": "middle" });
      label.textContent = compact(t, unit);
      root.append(label);
    }
    // X labels: about one per 80px, always including the last period.
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 80))));
    points.forEach((p, i) => {
      if ((n - 1 - i) % every !== 0) return;
      // Labels near an edge are anchored to it, so they're never clipped.
      const anchor = x(i) + 24 > width ? "end" : x(i) - 24 < 0 ? "start" : "middle";
      const label = svg("text", { x: anchor === "end" ? width - 2 : anchor === "start" ? 2 : x(i), y: height - 6, class: "chart-axis", "text-anchor": anchor });
      label.textContent = formatPeriod(p.date, opts.interval);
      root.append(label);
    });

    if (opts.form === "column") {
      // One series per chart here; several would be grouped side by side.
      const s = series[0];
      const w = Math.max(1, Math.min(24, band - 2, band * 0.7));
      points.forEach((p, i) => {
        const v = p.values[s.key] ?? 0;
        if (!v) return;
        const top = y(Math.max(v, 0));
        const bottom = y(Math.min(v, 0));
        const r = Math.min(4, w / 2, bottom - top);
        const x0 = x(i) - w / 2;
        // Rounded at the data end only: the top for positive values, the bottom for negative.
        const d =
          v > 0
            ? `M${x0},${bottom} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + w - r} Q${x0 + w},${top} ${x0 + w},${top + r} V${bottom} Z`
            : `M${x0},${top} V${bottom - r} Q${x0},${bottom} ${x0 + r},${bottom} H${x0 + w - r} Q${x0 + w},${bottom} ${x0 + w},${bottom - r} V${top} Z`;
        root.append(svg("path", { d, fill: color(0), class: "chart-column", "data-i": i }));
      });
    } else {
      series.forEach((s, si) => {
        const coords = points.map((p, i) => [x(i), y(p.values[s.key] ?? 0)]);
        if (!coords.length) return;
        const line = coords.map(([cx, cy], i) => `${i ? "L" : "M"}${cx.toFixed(1)},${cy.toFixed(1)}`).join(" ");
        if (series.length === 1) {
          root.append(svg("path", { d: `${line} L${coords.at(-1)[0]},${y(Math.max(0, yMin))} L${coords[0][0]},${y(Math.max(0, yMin))} Z`, fill: color(si), "fill-opacity": 0.1, stroke: "none" }));
        }
        root.append(svg("path", { d: line, fill: "none", stroke: color(si), "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
        // The end point, marked.
        const [ex, ey] = coords.at(-1);
        root.append(svg("circle", { cx: ex, cy: ey, r: 4, fill: color(si), stroke: surface, "stroke-width": 2 }));
      });
    }

    // Hover layer.
    const cross = svg("line", { y1: m.top, y2: m.top + ih, class: "chart-cross", visibility: "hidden" });
    const dots = series.map((_, si) => svg("circle", { r: 4, fill: color(si), stroke: surface, "stroke-width": 2, visibility: "hidden" }));
    root.append(cross, ...(opts.form === "column" ? [] : dots));
    const hit = svg("rect", { x: m.left, y: m.top, width: iw, height: ih, fill: "transparent" });
    root.append(hit);

    const show = (i) => {
      if (i === null || !points[i]) return hide();
      active = i;
      const p = points[i];
      cross.setAttribute("x1", x(i));
      cross.setAttribute("x2", x(i));
      cross.setAttribute("visibility", "visible");
      dots.forEach((dot, si) => {
        dot.setAttribute("cx", x(i));
        dot.setAttribute("cy", y(p.values[series[si].key] ?? 0));
        dot.setAttribute("visibility", "visible");
      });
      for (const col of root.querySelectorAll(".chart-column")) col.classList.toggle("dim", Number(col.dataset.i) !== i);
      tooltip.replaceChildren(
        h("div", { class: "chart-tooltip-title" }, formatPeriod(p.date, opts.interval, { long: true })),
        ...series.map((s, si) =>
          h("div", { class: "chart-tooltip-row" }, h("span", { class: "chart-swatch", style: { background: color(si) } }), h("span", null, s.label), h("strong", null, formatValue(p.values[s.key] ?? 0, unit))),
        ),
        ...(opts.extra?.(p) ?? []).map(([label, text]) => h("div", { class: "chart-tooltip-row muted" }, h("span", { class: "chart-swatch empty" }), h("span", null, label), h("span", null, text))),
      );
      tooltip.hidden = false;
      const tw = tooltip.offsetWidth;
      const left = x(i) + 12 + tw > width ? x(i) - 12 - tw : x(i) + 12;
      Object.assign(tooltip.style, { left: `${Math.max(0, left)}px`, top: `${m.top}px` });
    };
    const hide = () => {
      active = null;
      cross.setAttribute("visibility", "hidden");
      dots.forEach((dot) => dot.setAttribute("visibility", "hidden"));
      for (const col of root.querySelectorAll(".chart-column")) col.classList.remove("dim");
      tooltip.hidden = true;
    };
    const indexAt = (clientX) => {
      const box = root.getBoundingClientRect();
      const i = Math.floor((clientX - box.left - m.left) / band);
      return i >= 0 && i < n ? i : null;
    };
    hit.addEventListener("pointermove", (e) => show(indexAt(e.clientX)));
    hit.addEventListener("pointerleave", hide);
    root.addEventListener("blur", hide);
    root.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      const last = points.length - 1;
      const next = e.key === "Home" ? 0 : e.key === "End" ? last : active === null ? last : Math.min(last, Math.max(0, active + (e.key === "ArrowLeft" ? -1 : 1)));
      show(next);
    });
    root.addEventListener("focus", () => active === null && show(points.length - 1));

    plot.replaceChildren(root);
    if (active !== null) show(active);
  };

  draw();
  let lastWidth = plot.clientWidth;
  const resize = new ResizeObserver(() => {
    if (plot.clientWidth !== lastWidth) (lastWidth = plot.clientWidth), draw();
  });
  resize.observe(plot);
  const theme = new MutationObserver(draw);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // Stop observing once the chart leaves the page.
  const gone = new MutationObserver(() => {
    if (!host.isConnected) (resize.disconnect(), theme.disconnect(), gone.disconnect());
  });
  gone.observe(document.body, { childList: true, subtree: true });
}
