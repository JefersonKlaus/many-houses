// A list box: one compact row per item, a search field once the list is long, and pages of PAGE_SIZE
// rows ("‹ 1 de 3 ›"). The search looks at every item, not just the page shown, and goes back to page 1.
import { h, render } from "../util.js";

export const PAGE_SIZE = 10;
const SEARCH_FROM = 6;                          // a search field from this many items on

/** Lowercase, without accents: "São José" is found by "sao jose". */
const plain = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** `row(item)` draws one <li class="list-item">. `label`: what the list holds, for the search's
 *  placeholder. `searchText(item)`: what the search looks at. */
export function pagedList(items, row, { label, searchText = (item) => item.name }) {
  let page = 0, shown = items;
  const list = h("ul", { className: "item-list" });
  const nothingFound = h("p", { className: "muted list-empty", hidden: true }, "Nada encontrado.");
  const pager = h("div", { className: "pager", role: "navigation", "aria-label": "Páginas" });

  function draw() {
    const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    page = Math.min(page, pages - 1);
    render(list, shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row));
    nothingFound.hidden = shown.length > 0;
    const first = page * PAGE_SIZE + 1, last = Math.min(shown.length, (page + 1) * PAGE_SIZE);
    render(pager, pages > 1 && [
      h("span", { className: "muted" }, `${first}–${last} de ${shown.length}`),
      h("button", { className: "secondary small", "aria-label": "Página anterior", disabled: page === 0,
        onclick: () => { page -= 1; draw(); } }, "‹"),
      h("span", { className: "pager-page" }, `${page + 1} de ${pages}`),
      h("button", { className: "secondary small", "aria-label": "Próxima página", disabled: page === pages - 1,
        onclick: () => { page += 1; draw(); } }, "›")]);
  }

  const search = items.length >= SEARCH_FROM && h("input", { type: "search", className: "list-search",
    placeholder: `Buscar ${label}`, "aria-label": `Buscar ${label}`,
    oninput: (e) => {
      const wanted = plain(e.target.value.trim());
      shown = wanted ? items.filter((item) => plain(searchText(item)).includes(wanted)) : items;
      page = 0;
      draw();
    } });
  draw();
  return h("div", { className: "card list-card" }, search, list, nothingFound, pager);
}

/** The same pages for a table: `rows` are its <tr>s (or any rows, inside a `tag` other than <tbody>),
 *  PAGE_SIZE at a time. Returns [tbody, pager]: the pager goes right after the table. `start`: the page
 *  to open on (e.g. the one of the next installment). */
export function pagedRows(rows, { start = 0, tag = "tbody" } = {}) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  let page = Math.min(Math.max(0, start), pages - 1);
  const body = h(tag);                            // a <tbody>, or e.g. a <div> for a list of cards
  const pager = h("div", { className: "pager", role: "navigation", "aria-label": "Páginas" });
  const draw = () => {
    render(body, rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
    const first = page * PAGE_SIZE + 1, last = Math.min(rows.length, (page + 1) * PAGE_SIZE);
    render(pager, pages > 1 && [
      h("span", { className: "muted" }, `${first}–${last} de ${rows.length}`),
      h("button", { className: "secondary small", "aria-label": "Página anterior", disabled: page === 0,
        onclick: () => { page -= 1; draw(); } }, "‹"),
      h("span", { className: "pager-page" }, `${page + 1} de ${pages}`),
      h("button", { className: "secondary small", "aria-label": "Próxima página", disabled: page === pages - 1,
        onclick: () => { page += 1; draw(); } }, "›")]);
  };
  draw();
  return [body, pager];
}
