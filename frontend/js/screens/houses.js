// Casas: every house with what it cost (purchase + renovation), and each house's page with its purchase
// (price, entrada and the installments being paid), its renovation costs by category and the list of costs.
// Every change answers the house's whole page, which is drawn at once: one request per change, never two.
import { api } from "../api.js";
import { actionsMenu, centsToText, formatDate, formatMoney, h, notify, openDialog, percent, percentText, render,
  toCents, toPercent, today, whileDisabled } from "../util.js";
import { pagedList } from "./paged-list.js";

// The API's codes, in the order the screen shows them (backend/core/houses_core/domain/models.py).
const STATUS = { renovating: "Em reforma", ready: "Pronta", sold: "Vendida" };
const CATEGORIES = { material: "Material", labor: "Mão de obra", services: "Serviços",
  project: "Projeto e documentação", other: "Outros" };

const tile = (label, value, note) => h("div", {}, h("span", {}, label), h("strong", {}, value),
  note && h("small", { className: "muted" }, note));
// Offered as ready-made choices in the house form; any other area can be typed in.
const AREA_SUGGESTIONS = ["Cozinha", "Banheiros", "Quartos", "Sala", "Área de serviço", "Telhado", "Fachada",
  "Quintal", "Elétrica", "Hidráulica", "Pisos", "Pintura"];

const INSTALLMENTS_PAGE = 12;                   // a year of prestações per page

/** "2026-01-31" -> "2026-02-28": a month later, the same day or the month's last day (like the backend). */
function addMonth(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}
const badge = (status) => h("span", { className: `badge status-${status}` }, STATUS[status] || status);

export async function mount(container) {
  // ------------------------------------------------------------------ every house
  async function list() {
    let houses;
    try { houses = await api("GET", "/houses"); }
    catch (error) { return render(container, h("p", { className: "notice" }, error.message)); }
    const sum = (key) => houses.reduce((total, x) => total + x.totals[key], 0);
    const row = (x) => h("li", { className: "list-item clickable", tabindex: 0, role: "button",
      onclick: () => detail(x.id), onkeydown: (e) => { if (e.key === "Enter") detail(x.id); } },
    h("div", { className: "list-main" },
      h("div", { className: "list-title" }, h("strong", {}, x.name, badge(x.status)),
        h("strong", { className: "amount" }, formatMoney(x.totals.total_cents))),
      h("div", { className: "list-title muted" }, h("span", {}, x.address),
        h("span", {}, `compra ${formatMoney(x.totals.purchase_cents)} · reforma ${formatMoney(x.totals.renovation_cents)}`,
          x.target_profit_percent > 0 && x.status !== "sold" && ` · vender por ${formatMoney(x.totals.sale.suggested_price_cents)}`))),
    h("span", { className: "chevron", "aria-hidden": "true" }, "›"));
    render(container,
      h("div", { className: "row" }, h("h1", {}, "Casas", houses.length > 0 && h("span", { className: "count" }, ` (${houses.length})`)),
        h("button", { className: "primary", onclick: () => houseDialog(null, show) }, "Nova casa")),
      houses.length > 0 && h("div", { className: "totals", id: "portfolio" },
        tile("Compras", formatMoney(sum("purchase_cents"))), tile("Reformas", formatMoney(sum("renovation_cents"))),
        tile("Total investido", formatMoney(sum("total_cents")))),
      houses.length === 0 ? h("div", { className: "card empty-state" }, h("h2", {}, "Nenhuma casa ainda"),
        h("p", { className: "muted" }, "Cadastre a primeira casa comprada e acompanhe os custos da reforma."),
        h("button", { className: "primary", onclick: () => houseDialog(null, show) }, "Nova casa"))
        : pagedList(houses, row, { label: "casas (nome ou endereço)", searchText: (x) => `${x.name} ${x.address}` }));
  }

  // ------------------------------------------------------------------ one house
  async function detail(id) {
    render(container, h("p", { className: "notice" }, "Carregando…"));
    let view;
    try { view = await api("GET", `/houses/${id}`); }
    catch (error) { notify(error.message, true); return list(); }
    show(view);
  }

  /** Draws one house's page from what the API answered (GET /houses/{id} or any change to the house). */
  function show(view) {
    const { house, expenses, installments, totals } = view;
    const id = house.id;
    const remove = async () => {
      const what = [`${expenses.length} custo(s)`, installments.length > 0 && `${installments.length} prestação(ões)`]
        .filter(Boolean).join(" e ");
      if (!confirm(`Excluir "${house.name}" com ${what}? Isso não pode ser desfeito.`)) return;
      try { await api("DELETE", `/houses/${id}`); notify("Casa excluída."); list(); }
      catch (error) { notify(error.message, true); }
    };
    render(container,
      h("button", { className: "link back", onclick: list }, "‹ Casas"),
      h("div", { className: "row" },
        h("div", {}, h("h1", {}, house.name, badge(house.status)), h("p", { className: "muted address" }, house.address)),
        h("div", { className: "actions tight" },
          h("button", { className: "secondary", onclick: () => houseDialog(house, show) }, "Editar casa"),
          h("button", { className: "danger", onclick: remove }, "Excluir"))),
      h("div", { className: "totals", id: "house-totals" },
        tile("Compra", formatMoney(totals.purchase_cents)),
        tile("Reforma", formatMoney(totals.renovation_cents), `${totals.expense_count} custo(s)`),
        tile("Total investido", formatMoney(totals.total_cents))),
      saleCard(house, totals),
      purchaseCard(house, totals.payment),
      house.payment_type === "installments" && installmentsCard(house, installments, totals.payment),
      areasCard(house, totals),
      categoriesCard(totals),
      expensesCard(house, expenses, totals));
  }

  /** For how much to sell today, as it is, to make the profit wanted: it goes up with every renovation cost. */
  function saleCard(house, totals) {
    const { sale } = totals;
    if (!(sale.target_profit_percent > 0)) {
      return h("div", { className: "card sale", id: "sale" }, h("p", { className: "muted" },
        "Informe o lucro desejado (%) em “Editar casa” e o sistema mostra por quanto vender a casa hoje."));
    }
    return h("div", { className: "card sale", id: "sale" },
      h("span", { className: "sale-label" }, `Para lucrar ${percentText(sale.target_profit_percent)} %, venda hoje por`),
      h("strong", { className: "sale-price" }, formatMoney(sale.suggested_price_cents)),
      h("p", { className: "muted" }, `Total investido ${formatMoney(totals.total_cents)} + lucro de `
        + `${formatMoney(sale.target_profit_cents)}. O valor sobe a cada custo de reforma lançado.`));
  }

  function purchaseCard(house, payment) {
    const financed = house.payment_type === "installments";
    return h("div", { className: "card", id: "purchase" }, h("h2", {}, "Compra"),
      h("dl", { className: "details" },
        h("dt", {}, "Data"), h("dd", {}, formatDate(house.purchase_date)),
        h("dt", {}, "Pagamento"), h("dd", {}, financed ? "Parcelado" : "À vista"),
        h("dt", {}, "Valor do imóvel"), h("dd", {}, formatMoney(house.purchase_price_cents)),
        financed && [
          h("dt", {}, "Entrada"), h("dd", {}, formatMoney(payment.down_payment_cents)),
          h("dt", {}, "Restante"), h("dd", {}, formatMoney(house.purchase_price_cents - payment.down_payment_cents),
            h("span", { className: "muted" }, " (pago em prestações)"))],
        h("dt", {}, "Custos da compra"), h("dd", {}, formatMoney(house.purchase_costs_cents),
          h("span", { className: "muted" }, " (ITBI, escritura, registro, corretagem…)")),
        h("dt", {}, "Total"), h("dd", {}, h("strong", {}, formatMoney(house.purchase_price_cents + house.purchase_costs_cents)))),
      house.notes && h("p", { className: "notes" }, house.notes));
  }

  /** The prestações of the purchase: how much is paid, what is left, and each one with its state.
   *  A long plan (120, 360...) is shown a page at a time, opening on the page of the next one to pay. */
  function installmentsCard(house, installments, payment) {
    const add = h("button", { className: "primary small", onclick: () => planDialog(house) }, "Adicionar prestações");
    const card = h("div", { className: "card", id: "installments" }, h("div", { className: "row" }, h("h2", {}, "Prestações"), add));
    if (installments.length === 0) {
      card.append(h("p", { className: "muted" },
        "Nenhuma prestação. Adicione as prestações para marcar cada uma quando for paga."));
      return card;
    }
    const now = today();
    const change = (inst, changes, message) => async () => {
      try { show(await api("PUT", `/houses/${house.id}/installments/${inst.id}`, { ...inst, ...changes })); notify(message); }
      catch (error) { notify(error.message, true); }
    };
    const remove = async (inst, n) => {
      if (!confirm(`Excluir a prestação ${n} (${formatMoney(inst.amount_cents)}, vence ${formatDate(inst.due_date)})?`)) return;
      try { show(await api("DELETE", `/houses/${house.id}/installments/${inst.id}`)); notify("Prestação excluída."); }
      catch (error) { notify(error.message, true); }
    };
    const state = (inst) => inst.paid_date
      ? [h("span", { className: "badge paid" }, "Paga"), h("small", { className: "muted paid-on" }, formatDate(inst.paid_date))]
      : inst.due_date < now ? h("span", { className: "badge overdue" }, "Atrasada")
        : h("span", { className: "badge open" }, "Em aberto");
    const rows = installments.map((inst, index) => {
      const n = `${index + 1}/${installments.length}`;
      return h("tr", { className: inst.paid_date ? "paid" : null },
        h("td", { title: n }, index + 1), h("td", {}, formatDate(inst.due_date)),
        h("td", { className: "num" }, formatMoney(inst.amount_cents)), h("td", {}, state(inst)),
        h("td", {}, actionsMenu(`prestação ${n}`, [
          inst.paid_date ? { text: "Desmarcar pagamento", onclick: change(inst, { paid_date: "" }, "Pagamento desmarcado.") }
            : { text: "Marcar como paga hoje", onclick: change(inst, { paid_date: now }, "Prestação paga.") },
          { text: "Editar", onclick: () => installmentDialog(house, inst, n) },
          { text: "Excluir", danger: true, onclick: () => remove(inst, n) }])));
    });

    const pages = Math.ceil(rows.length / INSTALLMENTS_PAGE);
    const firstOpen = installments.findIndex((inst) => !inst.paid_date);
    let page = Math.floor((firstOpen < 0 ? rows.length - 1 : firstOpen) / INSTALLMENTS_PAGE);
    const body = h("tbody");
    const pager = h("div", { className: "pager" });
    const draw = () => {
      render(body, rows.slice(page * INSTALLMENTS_PAGE, (page + 1) * INSTALLMENTS_PAGE));
      render(pager, pages > 1 && [
        h("button", { className: "secondary small", "aria-label": "Página anterior", disabled: page === 0,
          onclick: () => { page -= 1; draw(); } }, "‹"),
        h("span", { className: "pager-page" }, `${page + 1} de ${pages}`),
        h("button", { className: "secondary small", "aria-label": "Próxima página", disabled: page === pages - 1,
          onclick: () => { page += 1; draw(); } }, "›")]);
    };
    draw();

    const progress = h("span", { className: "bar-fill paid-fill" });
    progress.style.width = `${((100 * payment.paid_count) / payment.installments_count).toFixed(1)}%`;   // CSSOM: allowed by the CSP
    card.append(
      h("div", { className: "totals" },
        tile("Pagas", `${payment.paid_count} de ${payment.installments_count}`, formatMoney(payment.paid_cents)),
        tile("Falta pagar", formatMoney(payment.open_cents),
          payment.next_due_date ? `próxima: ${formatDate(payment.next_due_date)}` : "tudo pago"),
        tile("Pago da compra", formatMoney(payment.total_paid_cents), "entrada + prestações pagas")),
      h("span", { className: "bar", title: percent(payment.paid_count, payment.installments_count) }, progress),
      h("div", { className: "table-scroll" }, h("table", { className: "money" },
        h("thead", {}, h("tr", {}, ["Nº", "Vencimento", "Valor", "Situação", ""].map((c) => h("th", { className: c === "Valor" ? "num" : null }, c)))),
        body)),
      pager);
    return card;
  }

  /** Which part of the house costs the most: one bar per area, the most expensive first, as a share
   *  of the renovation. Areas still without costs and the costs with no area are listed too. */
  function areasCard(house, totals) {
    const card = h("div", { className: "card", id: "areas" }, h("h2", {}, "Reforma por área"));
    if (house.areas.length === 0) {
      card.append(h("p", { className: "muted" },
        "Marque em “Editar casa” as áreas que precisam de reforma (cozinha, telhado…) e vincule cada custo a uma delas."));
      return card;
    }
    const rows = totals.by_area.filter((a) => a.cents > 0).sort((a, b) => b.cents - a.cents);
    if (totals.no_area_cents > 0) rows.push({ id: "", name: "Sem área", cents: totals.no_area_cents, none: true });
    const waiting = totals.by_area.filter((a) => a.cents === 0).map((a) => a.name);
    if (rows.length === 0) card.append(h("p", { className: "muted" }, "Nenhum custo lançado ainda."));
    else card.append(h("ul", { className: "bars" }, rows.map((a, index) => {
      const bar = h("span", { className: `bar-fill ${a.none ? "area-none" : index === 0 ? "area-top" : "area"}` });
      bar.style.width = `${((100 * a.cents) / totals.renovation_cents).toFixed(1)}%`;   // CSSOM: allowed by the CSP
      return h("li", {}, h("span", { className: "bar-label" }, a.name,
        index === 0 && !a.none && rows.length > 1 && h("small", { className: "top-tag" }, " mais cara")),
      h("span", { className: "bar" }, bar),
      h("span", { className: "bar-value" }, formatMoney(a.cents),
        h("small", { className: "muted" }, ` ${percent(a.cents, totals.renovation_cents)}`)));
    })));
    if (waiting.length > 0) card.append(h("p", { className: "muted" }, `Ainda sem custos: ${waiting.join(", ")}.`));
    return card;
  }

  /** Where the renovation money went: one bar per category, as a share of the renovation. */
  function categoriesCard(totals) {
    const used = Object.keys(CATEGORIES).filter((c) => totals.by_category[c] > 0);
    return h("div", { className: "card" }, h("h2", {}, "Reforma por categoria"),
      used.length === 0 ? h("p", { className: "muted" }, "Nenhum custo de reforma lançado ainda.")
        : h("ul", { className: "bars" }, used.map((c) => {
          const bar = h("span", { className: `bar-fill cat-${c}` });
          bar.style.width = `${((100 * totals.by_category[c]) / totals.renovation_cents).toFixed(1)}%`;   // CSSOM: allowed by the CSP
          return h("li", {}, h("span", { className: "bar-label" }, CATEGORIES[c]), h("span", { className: "bar" }, bar),
            h("span", { className: "bar-value" }, formatMoney(totals.by_category[c]),
              h("small", { className: "muted" }, ` ${percent(totals.by_category[c], totals.renovation_cents)}`)));
        })));
  }

  const areaName = (house, id) => house.areas.find((a) => a.id === id)?.name || "";

  function expensesCard(house, expenses, totals) {
    const add = h("button", { className: "primary small", onclick: () => expenseDialog(house, null) }, "Novo custo");
    const remove = async (e) => {
      if (!confirm(`Excluir o custo "${e.description}" (${formatMoney(e.amount_cents)})?`)) return;
      try { show(await api("DELETE", `/houses/${house.id}/expenses/${e.id}`)); notify("Custo excluído."); }
      catch (error) { notify(error.message, true); }
    };
    return h("div", { className: "card" },
      h("div", { className: "row" }, h("h2", {}, "Custos da reforma"), add),
      expenses.length === 0 ? h("p", { className: "muted" }, "Lance aqui cada compra de material, mão de obra ou serviço.")
        : h("div", { className: "table-scroll" }, h("table", { className: "money", id: "expenses" },
          h("thead", {}, h("tr", {}, ["Data", "Descrição", "Categoria", "Valor", ""].map((c) => h("th", { className: c === "Valor" ? "num" : null }, c)))),
          h("tbody", {}, expenses.map((e) => h("tr", {},
            h("td", {}, formatDate(e.date)),
            h("td", {}, e.description, e.supplier && h("div", { className: "muted" }, e.supplier)),
            h("td", {}, CATEGORIES[e.category] || e.category,
              e.area_id && h("div", { className: "muted" }, areaName(house, e.area_id))),
            h("td", { className: "num" }, formatMoney(e.amount_cents)),
            h("td", {}, actionsMenu(e.description, [
              { text: "Editar", onclick: () => expenseDialog(house, e) },
              { text: "Excluir", danger: true, onclick: () => remove(e) }]))))),
          h("tfoot", {}, h("tr", {}, h("td", { colSpan: 3 }, "Total da reforma"),
            h("td", { className: "num" }, formatMoney(totals.renovation_cents)), h("td", {}))))));
  }

  // ------------------------------------------------------------------ forms
  /** `options`: {value: text}, or [[value, text], ...] when the order must be kept (ids that look like numbers). */
  const select = (id, options, current) => h("select", { id },
    (Array.isArray(options) ? options : Object.entries(options)).map(([value, text]) => h("option", { value, selected: value === current }, text)));
  const field = (id, label, input) => [h("label", { htmlFor: id }, label), input];

  /** A money field: "1.234,56". Returns its cents, or throws with the field's name. */
  function cents(input, label, required = true) {
    if (!required && !input.value.trim()) return 0;
    const value = toCents(input.value);
    if (value === null) throw new Error(`${label}: informe um valor como 1.234,56`);
    return value;
  }

  function houseDialog(house, onSaved) {
    const name = h("input", { id: "h-name", maxLength: 80, value: house?.name || "", placeholder: "Ex.: Casa da Rua das Flores" });
    const address = h("input", { id: "h-address", maxLength: 200, value: house?.address || "" });
    const date = h("input", { id: "h-date", type: "date", value: house?.purchase_date || today() });
    const price = h("input", { id: "h-price", inputMode: "decimal", placeholder: "0,00",
      value: house ? centsToText(house.purchase_price_cents) : "" });
    const costs = h("input", { id: "h-costs", inputMode: "decimal", placeholder: "0,00",
      value: house ? centsToText(house.purchase_costs_cents) : "" });
    const status = select("h-status", STATUS, house?.status || "renovating");
    const notes = h("textarea", { id: "h-notes", maxLength: 2000, rows: 3, value: house?.notes || "" });
    const profit = h("input", { id: "h-profit", inputMode: "decimal", placeholder: "Ex.: 30",
      value: house?.target_profit_percent ? percentText(house.target_profit_percent) : "" });

    // the areas that need renovation: the house's own first (checked), then the suggestions not used yet
    const chips = h("div", { className: "chips", id: "h-areas" });
    const addChip = (name, checked) => chips.append(h("label", { className: "chip" },
      h("input", { type: "checkbox", value: name, checked }), name));
    const has = (name) => [...chips.querySelectorAll("input")].some((i) => i.value.toLowerCase() === name.toLowerCase());
    for (const area of house?.areas || []) addChip(area.name, true);
    for (const name of AREA_SUGGESTIONS) if (!has(name)) addChip(name, false);
    const otherArea = h("input", { id: "h-other-area", maxLength: 40, placeholder: "Outra área (ex.: Edícula)" });
    const addOther = () => {
      const name = otherArea.value.trim().replace(/\s+/g, " ");
      if (!name) return;
      const existing = [...chips.querySelectorAll("input")].find((i) => i.value.toLowerCase() === name.toLowerCase());
      if (existing) existing.checked = true; else addChip(name, true);
      otherArea.value = "";
      otherArea.focus();
    };
    otherArea.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addOther(); } });
    const areas = h("div", {},
      h("label", { htmlFor: "h-other-area" }, "Áreas que precisam de reforma"), chips,
      h("div", { className: "inline-add" }, otherArea,
        h("button", { type: "button", className: "secondary small", onclick: addOther }, "Adicionar")));

    // how it was paid: à vista, or parcelado with the entrada and (when registering) the installments
    const paymentType = house?.payment_type || "cash";
    const radio = (value, text) => h("label", { className: "choice" },
      h("input", { type: "radio", name: "h-payment", value, checked: value === paymentType, onchange: toggle }), text);
    const down = h("input", { id: "h-down", inputMode: "decimal", placeholder: "0,00",
      value: house?.down_payment_cents ? centsToText(house.down_payment_cents) : "" });
    const count = h("input", { id: "h-count", type: "number", min: 1, max: 600, inputMode: "numeric", placeholder: "Ex.: 120" });
    const amount = h("input", { id: "h-amount", inputMode: "decimal", placeholder: "0,00" });
    const first = h("input", { id: "h-first", type: "date" });
    const summary = h("p", { className: "muted hint", id: "h-summary" });
    const installments = h("div", { className: "installments-fields" },
      h("div", { className: "two-columns" },
        h("div", {}, field("h-down", "Entrada (R$)", down)),
        !house && [
          h("div", {}, field("h-count", "Quantidade de parcelas", count)),
          h("div", {}, field("h-amount", "Valor de cada parcela (R$)", amount)),
          h("div", {}, field("h-first", "Data da primeira parcela", first))]),
      house ? h("p", { className: "muted hint" }, "As prestações são alteradas na página da casa.") : summary);
    const chosen = () => dialog.querySelector("input[name=h-payment]:checked").value;
    function toggle() { installments.hidden = chosen() !== "installments"; }
    function updateSummary() {          // "Entrada R$ 60.000,00 + 120 × R$ 2.000,00 = R$ 300.000,00"
      const n = Number(count.value), each = toCents(amount.value), entrada = toCents(down.value || "0");
      summary.textContent = n > 0 && each !== null && entrada !== null
        ? `Entrada ${formatMoney(entrada)} + ${n} × ${formatMoney(each)} = ${formatMoney(entrada + n * each)}` : "";
    }
    for (const input of [down, count, amount]) input.addEventListener("input", updateSummary);
    // the first installment: a month after the purchase, following the purchase date until it is typed in
    let firstTyped = false;
    first.addEventListener("input", () => { firstTyped = true; });
    const followPurchase = () => { if (!firstTyped) first.value = addMonth(date.value); };
    date.addEventListener("input", followPurchase);
    date.addEventListener("change", followPurchase);
    followPurchase();

    const save = h("button", { className: "primary" }, "Salvar");
    const dialog = openDialog(house ? `Editar ${house.name}` : "Nova casa",
      field("h-name", "Nome", name), field("h-address", "Endereço", address),
      h("div", { className: "two-columns" },
        h("div", {}, field("h-date", "Data da compra", date)), h("div", {}, field("h-status", "Situação", status)),
        h("div", {}, field("h-price", "Valor do imóvel (R$)", price)),
        h("div", {}, field("h-costs", "Custos da compra (R$)", costs))),
      h("p", { className: "muted hint" }, "Custos da compra: ITBI, escritura, registro, corretagem, certidões…"),
      h("fieldset", { className: "choices" }, h("legend", {}, "Forma de pagamento"),
        radio("cash", "À vista"), radio("installments", "Parcelado")),
      installments,
      areas,
      field("h-profit", "Lucro desejado (%)", profit),
      h("p", { className: "muted hint" }, "Sobre o total investido (compra + reforma): a página da casa mostra por quanto vender hoje."),
      field("h-notes", "Observações", notes),
      h("div", { className: "actions" }, save, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    toggle();
    save.addEventListener("click", () => whileDisabled(save, async () => {
      try {
        const target = toPercent(profit.value);
        if (target === null) throw new Error("Lucro desejado: informe um percentual como 30 ou 12,5");
        const body = { name: name.value, address: address.value, purchase_date: date.value, status: status.value,
          notes: notes.value, purchase_price_cents: cents(price, "Valor do imóvel"),
          purchase_costs_cents: cents(costs, "Custos da compra", false),
          target_profit_percent: target, payment_type: chosen(),
          areas: [...chips.querySelectorAll("input:checked")].map((i) => i.value) };
        if (body.payment_type === "installments") {
          body.down_payment_cents = cents(down, "Entrada", false);
          if (!house) {
            if (!(Number(count.value) >= 1)) throw new Error("Quantidade de parcelas: informe quantas são");
            body.installments = { count: Number(count.value), amount_cents: cents(amount, "Valor de cada parcela"),
              first_due_date: first.value };
          }
        }
        const view = house ? await api("PUT", `/houses/${house.id}`, body) : await api("POST", "/houses", body);
        notify("Casa salva.");
        dialog.close();
        onSaved(view);
      } catch (error) { notify(error.message, true); }
    }));
    name.focus();
  }

  function expenseDialog(house, expense) {
    const date = h("input", { id: "e-date", type: "date", value: expense?.date || today() });
    const category = select("e-category", CATEGORIES, expense?.category || "material");
    const description = h("input", { id: "e-description", maxLength: 120, value: expense?.description || "",
      placeholder: "Ex.: Cimento e areia" });
    const supplier = h("input", { id: "e-supplier", maxLength: 80, value: expense?.supplier || "" });
    const amount = h("input", { id: "e-amount", inputMode: "decimal", placeholder: "0,00",
      value: expense ? centsToText(expense.amount_cents) : "" });
    const area = select("e-area", [["", "Sem área"], ...house.areas.map((a) => [a.id, a.name])], expense?.area_id || "");
    const save = h("button", { className: "primary" }, "Salvar");
    const dialog = openDialog(expense ? "Editar custo" : `Novo custo: ${house.name}`,
      field("e-description", "Descrição", description),
      h("div", { className: "two-columns" },
        h("div", {}, field("e-date", "Data", date)), h("div", {}, field("e-category", "Categoria", category)),
        h("div", {}, field("e-amount", "Valor (R$)", amount)), h("div", {}, field("e-supplier", "Fornecedor (opcional)", supplier))),
      house.areas.length > 0 ? field("e-area", "Área da casa", area)
        : h("p", { className: "muted hint" }, "Para vincular o custo a uma área (cozinha, telhado…), marque as áreas em “Editar casa”."),
      h("div", { className: "actions" }, save, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    save.addEventListener("click", () => whileDisabled(save, async () => {
      try {
        const body = { date: date.value, category: category.value, description: description.value,
          supplier: supplier.value, amount_cents: cents(amount, "Valor"), area_id: area.value };
        const view = expense ? await api("PUT", `/houses/${house.id}/expenses/${expense.id}`, body)
          : await api("POST", `/houses/${house.id}/expenses`, body);
        notify("Custo salvo.");
        dialog.close();
        show(view);
      } catch (error) { notify(error.message, true); }
    }));
    description.focus();
  }

  /** Adds N monthly installments at once: "120 de R$ 2.500,00, a primeira em 10/02/2026". */
  function planDialog(house) {
    const count = h("input", { id: "i-count", type: "number", min: 1, max: 600, value: 1, inputMode: "numeric" });
    const amount = h("input", { id: "i-amount", inputMode: "decimal", placeholder: "0,00" });
    const first = h("input", { id: "i-first", type: "date", value: today() });
    const save = h("button", { className: "primary" }, "Adicionar");
    const dialog = openDialog(`Prestações: ${house.name}`,
      h("div", { className: "two-columns" },
        h("div", {}, field("i-count", "Quantidade", count)), h("div", {}, field("i-amount", "Valor de cada uma (R$)", amount))),
      field("i-first", "Vencimento da primeira", first),
      h("p", { className: "muted hint" }, "Uma por mês, sempre no mesmo dia. Depois dá para editar cada uma (valor, vencimento)."),
      h("div", { className: "actions" }, save, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    save.addEventListener("click", () => whileDisabled(save, async () => {
      try {
        const body = { count: Number(count.value), amount_cents: cents(amount, "Valor de cada uma"), first_due_date: first.value };
        const view = await api("POST", `/houses/${house.id}/installments`, body);
        notify(body.count === 1 ? "Prestação adicionada." : `${body.count} prestações adicionadas.`);
        dialog.close();
        show(view);
      } catch (error) { notify(error.message, true); }
    }));
    amount.focus();
  }

  /** One installment: its due date, its amount and the day it was paid (empty: not paid). */
  function installmentDialog(house, inst, n) {
    const due = h("input", { id: "i-due", type: "date", value: inst.due_date });
    const amount = h("input", { id: "i-value", inputMode: "decimal", value: centsToText(inst.amount_cents) });
    const paid = h("input", { id: "i-paid", type: "date", value: inst.paid_date });
    const save = h("button", { className: "primary" }, "Salvar");
    const dialog = openDialog(`Prestação ${n}`,
      h("div", { className: "two-columns" },
        h("div", {}, field("i-due", "Vencimento", due)), h("div", {}, field("i-value", "Valor (R$)", amount))),
      field("i-paid", "Paga em (vazio se ainda não foi paga)", paid),
      h("div", { className: "actions" }, save, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    save.addEventListener("click", () => whileDisabled(save, async () => {
      try {
        const body = { due_date: due.value, amount_cents: cents(amount, "Valor"), paid_date: paid.value };
        const view = await api("PUT", `/houses/${house.id}/installments/${inst.id}`, body);
        notify("Prestação salva.");
        dialog.close();
        show(view);
      } catch (error) { notify(error.message, true); }
    }));
    amount.focus();
  }

  list();
}
