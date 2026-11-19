// A tiny element builder. Text is always added as text nodes (never parsed as HTML), so values from
// the API can't inject markup. Styles go through el.style, which the Content-Security-Policy allows.
//
//   h("button", { class: "btn", onClick: save, disabled: busy }, "Save")

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) setProps(el, props);
  append(el, children);
  return el;
}

function setProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "style") Object.assign(el.style, value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "value" || key === "checked") el[key] = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
}

/** Appends strings, nodes and (nested) arrays; skips null, undefined and booleans. */
export function append(el, children) {
  for (const child of [children].flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** Replaces an element's children. */
export function replace(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}
