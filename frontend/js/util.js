// Small helpers. Text coming from the user ALWAYS goes in as text (never as HTML).

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value == null) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key in el && key !== "list") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function render(container, ...children) {
  container.replaceChildren(...children.flat(Infinity).filter(Boolean));
}

export function notify(text, isError = false) {
  const el = h("div", { className: "toast" + (isError ? " error" : "") }, text);
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), isError ? 6000 : 3000);
}

export const formatMoney = (cents) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** 123456 -> "1.234,56": how an amount is shown in a field, ready to be read back by toCents. */
export const centsToText = (cents) =>
  (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "80,50", "1.200" or "R$ 1.200,00" (Brazilian format) -> integer cents. null if it is not an amount. */
export function toCents(text) {
  const cleaned = String(text).trim().replace(/\s/g, "").replace("R$", "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(cleaned)) return null;
  const [whole, cents = ""] = cleaned.replace(/\./g, "").split(",");
  return Number(whole) * 100 + Number(cents.padEnd(2, "0"));
}

/** "30", "12,5" or "12.5" -> 12.5; empty -> 0; null if it is not a percentage. */
export function toPercent(text) {
  const cleaned = String(text).trim().replace("%", "").trim().replace(",", ".");
  if (cleaned === "") return 0;
  return /^\d{1,4}(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : null;
}

/** 12.5 -> "12,5" */
export const percentText = (value) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** "2026-11-20" -> "20/11/2026". */
export const formatDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Today in Brasília (UTC-3 all year), "YYYY-MM-DD", whatever the device's time zone. */
export const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

/** "37,5 %" */
export const percent = (part, whole) =>
  `${(whole ? (100 * part) / whole : 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} %`;

/** A "⋮" button that opens a small menu of a row's actions (Editar, Excluir...).
 *  `items`: [{ text, onclick, danger }] (falsy ones are skipped). The menu is fixed on the screen, so a
 *  scrolling list never cuts it; it closes when an action is chosen, on a click outside, on Esc or when the page scrolls under it. */
export function actionsMenu(label, items) {
  const list = h("div", { className: "menu-list", role: "menu", hidden: true },
    items.filter(Boolean).map(({ text, onclick, danger }) => h("button", { role: "menuitem",
      className: danger ? "danger-item" : null, onclick: (e) => { close(); onclick(e); } }, text)));
  const button = h("button", { className: "kebab", title: "Ações", "aria-label": `Ações: ${label}`,
    "aria-haspopup": "menu", "aria-expanded": "false", onclick: (e) => { e.stopPropagation(); list.hidden ? open() : close(); } }, "⋮");
  const outside = (e) => { if (!list.contains(e.target) && e.target !== button) close(); };
  const keys = (e) => { if (e.key === "Escape") { close(); button.focus(); } };
  let openedAt = null;           // where the button was when the menu opened
  const scrolled = () => { if (button.getBoundingClientRect().top !== openedAt) close(); };   // it moved: close
  function open() {
    const r = button.getBoundingClientRect();
    openedAt = r.top;
    list.style.right = `${document.documentElement.clientWidth - r.right}px`;
    list.hidden = false;
    const below = r.bottom + 4 + list.offsetHeight <= window.innerHeight;     // no room below: opens upwards
    list.style.top = `${below ? r.bottom + 4 : Math.max(4, r.top - 4 - list.offsetHeight)}px`;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", keys);
    document.addEventListener("scroll", scrolled, true);
    list.querySelector("button")?.focus();
  }
  function close() {
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", outside, true);
    document.removeEventListener("keydown", keys);
    document.removeEventListener("scroll", scrolled, true);
  }
  return h("div", { className: "menu" }, button, list);
}

/** Runs an action with the button disabled, so repeated clicks don't send it twice. */
export async function whileDisabled(button, action) {
  button.disabled = true;
  try { return await action(); } finally { button.disabled = false; }
}

/** Opens a modal <dialog>. It is removed from the page when closed; clicking outside it closes it too. */
export function openDialog(title, ...children) {
  const dialog = h("dialog", { className: "dialog" }, h("h2", {}, title), ...children);
  dialog.addEventListener("click", (e) => {          // the backdrop counts as the <dialog> itself
    const r = dialog.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (e.target === dialog && outside) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
