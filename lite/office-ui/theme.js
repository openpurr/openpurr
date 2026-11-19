// Applies the saved theme (light, dark or auto = follow the system) before the page paints.
// Mirrors resolveTheme() in js/ui.js.
(function () {
  var dark;
  try {
    var t = localStorage.getItem("openpurr_theme") || "auto";
    dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  } catch (e) {
    dark = matchMedia("(prefers-color-scheme: dark)").matches;
  }
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();
