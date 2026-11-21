// Casas: every house with what it cost (purchase + renovation), and each house's page with its purchase
// (price, entrada and the installments being paid), its renovation costs by category and the list of costs.
// Every change answers the house's whole page, which is drawn at once: one request per change, never two.
import { api } from "../api.js";
import { actionsMenu, centsToText, formatDate, formatMoney, h, notify, openDialog, percent, render, toCents, today,
  whileDisabled } from "../util.js";
import { pagedList } from "./paged-list.js";

// The API's codes, in the order the screen shows them (backend/core/houses_core/domain/models.py).
const STATUS = { renovating: "Em reforma", ready: "Pronta", sold: "Vendida" };
const CATEGORIES = { material: "Material", labor: "Mão de obra", services: "Serviços",
  project: "Projeto e documentação", other: "Outros" };

const tile = (label, value, note) => h("div", {}, h("span", {}, label), h("strong", {}, value),
  note && h("small", { className: "muted" }, note));
const INSTALLMENTS_PAGE = 12;                   // a year of prestações per page
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
        h("span", {}, `compra ${formatMoney(x.totals.purchase_cents)} · reforma ${formatMoney(x.totals.renovation_cents)}`))),
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
      purchaseCard(house, totals.payment),
      installmentsCard(house, installments, totals.payment),
      categoriesCard(totals),
      expensesCard(house, expenses, totals));
  }

  function purchaseCard(house, payment) {
    const financed = payment.down_payment_cents > 0 || payment.installments_count > 0;
    return h("div", { className: "card", id: "purchase" }, h("h2", {}, "Compra"),
      h("dl", { className: "details" },
        h("dt", {}, "Data"), h("dd", {}, formatDate(house.purchase_date)),
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
        "Comprou parcelado? Informe a entrada em “Editar casa” e adicione aqui as prestações, para marcar cada uma quando for paga."));
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
            h("td", {}, CATEGORIES[e.category] || e.category),
            h("td", { className: "num" }, formatMoney(e.amount_cents)),
            h("td", {}, actionsMenu(e.description, [
              { text: "Editar", onclick: () => expenseDialog(house, e) },
              { text: "Excluir", danger: true, onclick: () => remove(e) }]))))),
          h("tfoot", {}, h("tr", {}, h("td", { colSpan: 3 }, "Total da reforma"),
            h("td", { className: "num" }, formatMoney(totals.renovation_cents)), h("td", {}))))));
  }

  // ------------------------------------------------------------------ forms
  const select = (id, options, current) => h("select", { id },
    Object.entries(options).map(([value, text]) => h("option", { value, selected: value === current }, text)));
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
    const down = h("input", { id: "h-down", inputMode: "decimal", placeholder: "0,00",
      value: house?.down_payment_cents ? centsToText(house.down_payment_cents) : "" });
    const status = select("h-status", STATUS, house?.status || "renovating");
    const notes = h("textarea", { id: "h-notes", maxLength: 2000, rows: 3, value: house?.notes || "" });
    const save = h("button", { className: "primary" }, "Salvar");
    const dialog = openDialog(house ? `Editar ${house.name}` : "Nova casa",
      field("h-name", "Nome", name), field("h-address", "Endereço", address),
      h("div", { className: "two-columns" },
        h("div", {}, field("h-date", "Data da compra", date)), h("div", {}, field("h-status", "Situação", status)),
        h("div", {}, field("h-price", "Valor do imóvel (R$)", price)),
        h("div", {}, field("h-down", "Entrada (R$, se parcelado)", down)),
        h("div", {}, field("h-costs", "Custos da compra (R$)", costs))),
      h("p", { className: "muted hint" }, "Entrada: deixe em branco se pagou à vista. As prestações são adicionadas na página da casa."),
      h("p", { className: "muted hint" }, "Custos da compra: ITBI, escritura, registro, corretagem, certidões…"),
      field("h-notes", "Observações", notes),
      h("div", { className: "actions" }, save, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    save.addEventListener("click", () => whileDisabled(save, async () => {
      try {
        const body = { name: name.value, address: address.value, purchase_date: date.value, status: status.value,
          notes: notes.value, purchase_price_cents: cents(price, "Valor do imóvel"),
          purchase_costs_cents: cents(costs, "Custos da compra", false),
          down_payment_cents: cents(down, "Entrada", false) };
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
    const save = h("button", { className: "primary" }, "Salvar");
    const dialog = openDialog(expense ? "Editar custo" : `Novo custo: ${house.name}`,
      field("e-description", "Descrição", description),
      h("div", { className: "two-columns" },
        h("div", {}, field("e-date", "Data", date)), h("div", {}, field("e-category", "Categoria", category)),
        h("div", {}, field("e-amount", "Valor (R$)", amount)), h("div", {}, field("e-supplier", "Fornecedor (opcional)", supplier))),
      h("div", { className: "actions" }, save, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    save.addEventListener("click", () => whileDisabled(save, async () => {
      try {
        const body = { date: date.value, category: category.value, description: description.value,
          supplier: supplier.value, amount_cents: cents(amount, "Valor") };
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
