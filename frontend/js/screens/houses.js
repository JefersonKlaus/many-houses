// Casas: every house with what it cost (purchase + renovation), and each house's page with its purchase
// (price, entrada and the installments being paid), its renovation costs by area and category, the list of
// costs (with photos of the NF and of the material or service), the timeline of photos from the purchase to
// the end and, for a house bought with partners, how much each one put in. Invites to be a partner and bills coming
// due are in Avisos. Every change answers the house's whole page, which is drawn at once: one request
// per change, never two.
import { api, uploadPhoto } from "../api.js";
import { actionsMenu, centsToText, dateInput, dateValue, formatDate, formatMoney, formatPhone, h, notify, openDialog, percent, percentText,
  render, toCents, toPercent, today, viewPhoto, whileDisabled } from "../util.js";
import { nav } from "../nav.js";
import { PAGE_SIZE, pagedList, pagedRows } from "./paged-list.js";

// The API's codes, in the order the screen shows them (backend/core/houses_core/domain/models.py).
const STATUS = { renovating: "Em reforma", ready: "Pronta", sold: "Vendida" };
const CATEGORIES = { material: "Material", labor: "Mão de obra", services: "Serviços",
  project: "Projeto e documentação", other: "Outros" };

const tile = (label, value, note) => h("div", {}, h("span", {}, label), h("strong", {}, value),
  note && h("small", { className: "muted" }, note));
// Offered as ready-made choices in the house form; any other area can be typed in.
const AREA_SUGGESTIONS = ["Cozinha", "Banheiros", "Quartos", "Sala", "Área de serviço", "Telhado", "Fachada",
  "Quintal", "Elétrica", "Hidráulica", "Pisos", "Pintura"];

/** "2026-01-31" -> "2026-02-28": a month later, the same day or the month's last day (like the backend). */
function addMonth(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}
const badge = (status) => h("span", { className: `badge status-${status}` }, STATUS[status] || status);

/** `params` {house, tab}: open that house on that tab (what a notice in Avisos links to); without them, the list. */
export async function mount(container, params = {}) {
  // ------------------------------------------------------------------ every house
  let showSold = false;        // sold houses are hidden from the list (and its totals) unless asked for

  async function list() {
    let all;
    try { all = await api("GET", "/houses"); }
    catch (error) { return render(container, h("p", { className: "notice" }, error.message)); }
    nav.report({ houses: all });
    const sold = all.filter((x) => x.status === "sold").length;
    const houses = showSold ? all : all.filter((x) => x.status !== "sold");
    const sum = (key) => houses.reduce((total, x) => total + x.totals[key], 0);
    const row = (x) => h("li", { className: "list-item clickable", tabindex: 0, role: "button",
      onclick: () => detail(x.id), onkeydown: (e) => { if (e.key === "Enter") detail(x.id); } },
    h("div", { className: "list-main" },
      h("div", { className: "list-title" }, h("strong", {}, x.name, badge(x.status),
        (x.role === "partner" || x.partners.length > 0) && h("span", { className: "badge partner" }, "Com sócios"),
        x.bundle_id && h("span", { className: "badge partner" }, "Compra conjunta")),
        h("strong", { className: "amount" }, formatMoney(x.totals.total_cents))),
      h("div", { className: "list-title muted" }, h("span", {}, x.address),
        h("span", {}, `compra ${formatMoney(x.totals.purchase_cents)} · reforma ${formatMoney(x.totals.renovation_cents)}`,
          x.target_profit_percent > 0 && x.status !== "sold" && ` · vender por ${formatMoney(x.totals.sale.suggested_price_cents)}`))),
    h("span", { className: "chevron", "aria-hidden": "true" }, "›"));
    render(container,
      h("div", { className: "row" }, h("h1", {}, "Casas", houses.length > 0 && h("span", { className: "count" }, ` (${houses.length})`)),
        h("button", { className: "primary", onclick: newHouse }, "Nova casa")),
      houses.length > 0 && h("div", { className: "totals", id: "portfolio" },
        tile("Compras", formatMoney(sum("purchase_cents"))), tile("Reformas", formatMoney(sum("renovation_cents"))),
        tile("Total investido", formatMoney(sum("total_cents")))),
      all.length === 0 ? h("div", { className: "card empty-state" }, h("h2", {}, "Nenhuma casa ainda"),
        h("p", { className: "muted" }, "Cadastre a primeira casa comprada e acompanhe os custos da reforma."),
        h("button", { className: "primary", onclick: newHouse }, "Nova casa"))
        : houses.length === 0 ? h("p", { className: "notice" }, "Nenhuma casa à venda ou em reforma.")
          : pagedList(houses, row, { label: "casas (nome ou endereço)", searchText: (x) => `${x.name} ${x.address}` }),
      sold > 0 && h("div", { className: "actions" }, h("button", { className: "link", id: "toggle-sold",
        onclick: () => { showSold = !showSold; list(); } }, showSold ? "Ocultar vendidas" : `Mostrar vendidas (${sold})`)));
  }

  /** The form of a new house, with the profit wanted set in Configurações already filled in. */
  async function newHouse(e) {
    await whileDisabled(e.currentTarget, async () => {
      let defaults = { default_profit_percent: 0 };
      try { defaults = await api("GET", "/settings"); } catch { /* without them the field just starts empty */ }
      houseForm(null, defaults);
    });
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
  // The house on screen: who its members are and who the user is among them (see show()).
  let ctx = { members: [], me: "", role: "owner", shared: false };
  /** A partner's name on screen: "Você", their name, or their phone when their login has no name. */
  const memberName = (id) => {
    if (id === ctx.me || (!id && ctx.role === "owner")) return "Você";
    const member = ctx.members.find((m) => m.id === (id || ctx.members[0]?.id));
    return member ? member.name || formatPhone(member.phone) || "Sócio" : "";
  };

  let lastView = null;      // the house on screen: what a redraw without a request (another month) draws again

  function show(view) {
    lastView = view;
    nav.report({ house: view });
    const { house, expenses, installments, totals } = view;
    const id = house.id;
    ctx = { members: view.members, me: view.me, role: view.role, shared: view.members.length > 1 };
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
          h("button", { className: "secondary", onclick: () => houseForm(house) }, "Editar casa"),
          h("button", { className: "danger", onclick: remove }, "Excluir"))),
      h("div", { className: "totals", id: "house-totals" },
        tile("Compra", formatMoney(totals.purchase_cents)),
        tile("Reforma", formatMoney(totals.renovation_cents), `${totals.expense_count} custo(s)`),
        tile("Total investido", formatMoney(totals.total_cents))),
      saleCard(house, totals),
      tabs(house.id, [
        ["purchase", house.payment_type === "installments"
          ? `Compra (${totals.payment.paid_count}/${totals.payment.installments_count})` : "Compra",
        () => [purchaseCard(house, totals.payment, view.bundle),
          house.payment_type === "installments" && installmentsCard(house, installments, totals.payment, view.bundle)]],
        // "Despesas recorrentes" where there is room, just "Recorrentes" on a small screen (style.css)
        ["recurring", [h("span", { className: "tab-long" }, "Despesas recorrentes"), h("span", { className: "tab-short" }, "Recorrentes"),
          totals.recurring_count ? ` (${totals.recurring_count})` : ""],
          () => [recurringCard(house, expenses.filter((e) => e.category === "recurring"))]],
        ["renovation", "Reforma", () => [areasCard(house, totals), categoriesCard(totals),
          expensesCard(house, expenses.filter((e) => e.category !== "recurring"), totals)]],
        ["timeline", view.timeline.length ? `Timeline (${view.timeline.length})` : "Timeline", () => [timelineCard(house, view.timeline)]],
        ["partners", ctx.shared ? `Sócios (${view.members.length})` : "Sócios", () => [partnersCard(view), investmentCard(view)]],
      ]));
  }

  // The tab open on each house's page: it stays open when the page is redrawn after a change.
  const openTab = {};

  /** Tabs: [[key, label, () => panel's children]...] (falsy ones are skipped). Arrow keys move between them. */
  function tabs(houseId, list) {
    list = list.filter(Boolean);
    if (!list.some(([key]) => key === openTab[houseId])) openTab[houseId] = list[0][0];
    const buttons = [], panels = [];
    const select = (key, focus = false) => {
      openTab[houseId] = key;
      list.forEach(([k], i) => {
        const on = k === key;
        buttons[i].setAttribute("aria-selected", String(on));
        buttons[i].tabIndex = on ? 0 : -1;
        panels[i].hidden = !on;
        if (on && focus) buttons[i].focus();
      });
    };
    list.forEach(([key, label, content]) => {
      buttons.push(h("button", { type: "button", role: "tab", id: `tab-${key}`, "aria-controls": `panel-${key}`,
        onclick: () => select(key),
        onkeydown: (e) => {
          const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
          if (!step) return;
          const i = list.findIndex(([k]) => k === key);
          select(list[(i + step + list.length) % list.length][0], true);
        } }, label));
      panels.push(h("div", { role: "tabpanel", id: `panel-${key}`, "aria-labelledby": `tab-${key}` }, content()));
    });
    select(openTab[houseId]);
    return [h("div", { className: "tabs", role: "tablist", "aria-label": "Seções da casa" }, buttons), panels];
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

  /** "Casa Azul 66,67 % · Casa Verde 33,33 %": the houses bought in the same deal and each one's share. */
  const bundleText = (bundle) => bundle.map((b) => `${b.name} ${percentText(b.percent)} %`).join(" · ");

  function purchaseCard(house, payment, bundle = []) {
    const financed = house.payment_type === "installments";
    return h("div", { className: "card", id: "purchase" }, h("h2", {}, "Compra"),
      h("dl", { className: "details" },
        h("dt", {}, "Data"), h("dd", {}, formatDate(house.purchase_date)),
        h("dt", {}, "Pagamento"), h("dd", {}, financed ? "Parcelado" : "À vista"),
        bundle.length > 1 && [h("dt", {}, "Compra conjunta"), h("dd", {}, bundleText(bundle),
          h("span", { className: "muted" }, " (a entrada e as prestações são divididas nessa proporção, pelo valor de cada imóvel)"))],
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
  function installmentsCard(house, installments, payment, bundle = []) {
    const grouped = bundle.length > 1;
    const add = h("button", { className: "primary small", onclick: () => planDialog(house, bundle) }, "Adicionar prestações");
    const card = h("div", { className: "card", id: "installments" }, h("div", { className: "row" }, h("h2", {}, "Prestações"), add));
    if (installments.length === 0) {
      card.append(h("p", { className: "muted" },
        "Nenhuma prestação. Adicione as prestações para marcar cada uma quando for paga."));
      return card;
    }
    const now = today();
    const change = (inst, changes, message) => async () => {     // marked as paid: by the user
      try { show(await api("PUT", `/houses/${house.id}/installments/${inst.id}`, { ...inst, ...changes })); notify(message); }
      catch (error) { notify(error.message, true); }
    };
    const remove = async (inst, n) => {
      if (!confirm(grouped && inst.group_id
        ? `Excluir a prestação ${n} (${formatMoney(inst.total_cents)}, vence ${formatDate(inst.due_date)}) de todas as casas desta compra?`
        : `Excluir a prestação ${n} (${formatMoney(inst.amount_cents)}, vence ${formatDate(inst.due_date)})?`)) return;
      try { show(await api("DELETE", `/houses/${house.id}/installments/${inst.id}`)); notify("Prestação excluída."); }
      catch (error) { notify(error.message, true); }
    };
    const state = (inst) => inst.paid_date
      ? [h("span", { className: "badge paid" }, "Paga"), h("small", { className: "muted paid-on" }, formatDate(inst.paid_date)),
        ctx.shared && h("small", { className: "muted paid-on" }, memberName(inst.paid_by))]
      : inst.due_date < now ? h("span", { className: "badge overdue" }, "Atrasada")
        : h("span", { className: "badge open" }, "Em aberto");
    const rows = installments.map((inst, index) => {
      const n = `${index + 1}/${installments.length}`;
      return h("tr", { className: inst.paid_date ? "paid" : null },
        h("td", { title: n }, index + 1), h("td", {}, formatDate(inst.due_date)),
        grouped && h("td", { className: "num" }, inst.group_id ? formatMoney(inst.total_cents) : "–"),
        h("td", { className: "num" }, formatMoney(inst.amount_cents),
          grouped && inst.group_id && inst.total_cents > 0 && h("small", { className: "muted" }, ` ${percent(inst.amount_cents, inst.total_cents)}`)),
        h("td", {}, state(inst)),
        h("td", {}, actionsMenu(`prestação ${n}`, [
          inst.paid_date ? { text: "Desmarcar pagamento", onclick: change(inst, { paid_date: "", paid_by: "" }, "Pagamento desmarcado.") }
            : { text: "Marcar como paga hoje", onclick: change(inst, { paid_date: now, paid_by: ctx.me }, "Prestação paga.") },
          { text: "Editar", onclick: () => installmentDialog(house, inst, n, grouped) },
          { text: "Excluir", danger: true, onclick: () => remove(inst, n) }])));
    });

    const firstOpen = installments.findIndex((inst) => !inst.paid_date);       // opens on the next one to pay
    const [body, pager] = pagedRows(rows, { start: Math.floor((firstOpen < 0 ? rows.length - 1 : firstOpen) / PAGE_SIZE) });

    const progress = h("span", { className: "bar-fill paid-fill" });
    progress.style.width = `${((100 * payment.paid_count) / payment.installments_count).toFixed(1)}%`;   // CSSOM: allowed by the CSP
    card.append(
      grouped && h("p", { className: "muted hint", id: "bundle-note" },
        `Compra conjunta: cada parcela é paga uma vez só, pelas ${bundle.length} casas (${bundleText(bundle)}). `
        + "Marcar como paga, mudar o vencimento ou excluir vale para todas."),
      h("div", { className: "totals" },
        tile("Pagas", `${payment.paid_count} de ${payment.installments_count}`, formatMoney(payment.paid_cents)),
        tile("Falta pagar", formatMoney(payment.open_cents),
          payment.next_due_date ? `próxima: ${formatDate(payment.next_due_date)}` : "tudo pago"),
        tile("Pago da compra", formatMoney(payment.total_paid_cents), "entrada + prestações pagas")),
      h("span", { className: "bar", title: percent(payment.paid_count, payment.installments_count) }, progress),
      h("div", { className: "table-scroll" }, h("table", { className: "money", id: "installments-table" },
        h("thead", {}, h("tr", {}, [
          "Nº", "Vencimento", grouped && "Parcela total", grouped ? "Desta casa" : "Valor", "Situação", ""].filter((c) => c !== false).map((c) =>
          h("th", { className: ["Valor", "Parcela total", "Desta casa"].includes(c) ? "num" : null }, c)))),
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

  // ------------------------------------------------------------------ recurring bills
  // Like an accounts-payable screen: a month at a time, one line per bill with its state (paid, due soon, late,
  // open) and a Pagar button. The bills (name + due day) are registered once; a payment is a recurring cost of
  // the month it refers to (its `reference`), which may not be the month it was paid in.
  const shiftMonth = (ym, n) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
  };
  const monthName = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  };
  const monthOf = {};          // house id -> the month on screen ("YYYY-MM"; this month by default)
  const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const refOf = (payment) => payment.reference || payment.date.slice(0, 7);

  /** The state of a bill of a month: from its due date and today. */
  function billState(due, paid) {
    if (paid) return h("span", { className: "badge paid" }, "Paga");
    const days = Math.round((Date.parse(due) - Date.parse(today())) / 86400000);
    if (days < 0) return h("span", { className: "badge overdue" }, `Atrasada ${-days} dia${days === -1 ? "" : "s"}`);
    if (days <= 2) return h("span", { className: "badge soon" }, days === 0 ? "Vence hoje" : days === 1 ? "Vence amanhã" : "Vence em 2 dias");
    return h("span", { className: "badge open" }, "Em aberto");
  }

  function recurringCard(house, payments) {
    const month = monthOf[house.id] || today().slice(0, 7);
    const go = (n) => { monthOf[house.id] = shiftMonth(month, n); show(lastView); };
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const save = async (list, message) => {
      try { show(await api("PUT", `/houses/${house.id}/recurring`, { bills: list.map(({ name, day, until }) => ({ name, day, until: until || "" })) })); notify(message); }
      catch (error) { notify(error.message, true); }
    };
    const removePayment = async (p) => {
      if (!confirm(`Excluir o pagamento "${p.description}" (${formatMoney(p.amount_cents)})?`)) return;
      try { show(await api("DELETE", `/houses/${house.id}/expenses/${p.id}`)); notify("Pagamento excluído."); }
      catch (error) { notify(error.message, true); }
    };
    const inMonth = payments.filter((p) => refOf(p) === month);
    const used = new Set();
    // a bill shows in the months it is due: from the one it was registered in to the one it was cancelled in
    const active = house.recurring_bills.filter((b) => (!b.since || month >= b.since) && (!b.until || month <= b.until));
    const lines = [...active].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name)).map((bill) => {
      const payment = inMonth.find((p) => !used.has(p.id) && sameName(p.description, bill.name));
      if (payment) used.add(payment.id);
      return { bill, payment, due: `${month}-${String(Math.min(bill.day, lastDay)).padStart(2, "0")}` };
    });
    const loose = inMonth.filter((p) => !used.has(p.id)).map((payment) => ({ bill: null, payment, due: "" }));   // not in the bills
    const rows = [...lines, ...loose].map(({ bill, payment, due }) => {
      const name = bill ? bill.name : payment.description;
      const detail = [due ? `vence dia ${due.slice(8)}` : "avulsa",
        bill?.until && `encerra em ${monthName(bill.until)}`,
        payment && `paga em ${formatDate(payment.date)}`, payment && ctx.shared && `por ${memberName(payment.paid_by)}`]
        .filter(Boolean).join(" · ");
      const menu = [
        payment && { text: "Editar pagamento", onclick: () => recurringDialog(house, payment, null, month) },
        payment && { text: "Excluir pagamento", danger: true, onclick: () => removePayment(payment) },
        bill && (bill.until
          ? { text: "Reativar conta", onclick: () => save(house.recurring_bills.map((x) => (x.id === bill.id ? { ...x, until: "" } : x)), "Conta reativada.") }
          : { text: "Encerrar conta", onclick: () => endDialog(house, bill, month, save) }),
        bill && { text: "Editar conta", onclick: () => scheduleDialog(house, bill, house.recurring_bills, save) },
        bill && { text: "Excluir conta", danger: true, onclick: () => {
          if (confirm(`Excluir a conta "${bill.name}"? Os pagamentos já registrados ficam.`)) save(house.recurring_bills.filter((x) => x.id !== bill.id), "Conta excluída."); } }]
        .filter(Boolean);
      return h("li", { className: "list-item bill" },
        h("div", { className: "list-main" }, h("strong", {}, name), h("div", { className: "muted" }, detail)),
        h("div", { className: "bill-side" },
          payment ? h("strong", { className: "bill-amount" }, formatMoney(payment.amount_cents)) : null,
          billState(due, Boolean(payment)),
          !payment && h("button", { className: "primary small", onclick: () => recurringDialog(house, null, { name, due }, month) }, "Pagar"),
          actionsMenu(name, menu)));
    });
    const paidCents = inMonth.reduce((sum, p) => sum + p.amount_cents, 0);
    const paidCount = lines.filter((l) => l.payment).length;
    const monthBar = h("div", { className: "month-nav" },
      h("button", { className: "secondary small", "aria-label": "Mês anterior", onclick: () => go(-1) }, "‹"),
      h("strong", { id: "recurring-month" }, monthName(month)),
      h("button", { className: "secondary small", "aria-label": "Próximo mês", onclick: () => go(1) }, "›"),
      month !== today().slice(0, 7) && h("button", { className: "link", onclick: () => { monthOf[house.id] = ""; show(lastView); } }, "Hoje"));
    return h("div", { className: "card", id: "recurring" },
      h("div", { className: "row" }, h("h2", {}, "Contas recorrentes"),
        h("div", { className: "actions tight" },
          h("button", { className: "secondary small", id: "new-recurring", onclick: () => recurringDialog(house, null, null, month) }, "Lançar pagamento"),
          h("button", { className: "primary small", id: "new-schedule", onclick: () => scheduleDialog(house, null, house.recurring_bills, save) }, "Cadastrar conta"))),
      monthBar,
      rows.length === 0 ? h("p", { className: "muted", id: "recurring-empty" }, house.recurring_bills.length === 0
        ? "Cadastre as contas que vencem todo mês (energia, água, internet…) com o dia do vencimento. Dois dias antes o sistema avisa em Avisos."
        : "Nada lançado neste mês.")
        : [h("div", { className: "totals" },
          tile("Pagas", `${paidCount} de ${lines.length}`, "contas do mês"), tile("Total pago", formatMoney(paidCents), monthName(month))),
          h("ul", { className: "list", id: "recurring-bills" }, rows)]);
  }

  /** Cancels a bill (the Netflix you stopped paying): it stops being charged after the month chosen, its payments
   *  stay in the history and the warnings stop. Unlike deleting it, which forgets it in every month. */
  function endDialog(house, bill, month, save) {
    const last = h("input", { id: "end-month", type: "month", value: month });
    const button = h("button", { className: "primary" }, "Encerrar");
    const dialog = openDialog(`Encerrar ${bill.name}`,
      h("p", { className: "muted" }, "A conta deixa de ser cobrada depois do mês escolhido. Os pagamentos já lançados ficam no histórico."),
      field("end-month", "Última cobrança em", last),
      h("div", { className: "actions" }, button, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    button.addEventListener("click", () => whileDisabled(button, async () => {
      if (!last.value) return notify("Escolha o último mês da cobrança.", true);
      await save(house.recurring_bills.map((x) => (x.id === bill.id ? { ...x, until: last.value } : x)), "Conta encerrada.");
      dialog.close();
    }));
  }

  function scheduleDialog(house, bill, list, save) {
    const name = h("input", { id: "s-name", maxLength: 60, value: bill?.name || "", placeholder: "Ex.: Energia, Água, Internet", autocomplete: "off" });
    const day = h("input", { id: "s-day", type: "number", min: 1, max: 31, inputMode: "numeric", value: bill?.day || "", placeholder: "1 a 31" });
    const button = h("button", { className: "primary" }, "Salvar");
    const dialog = openDialog(bill ? "Editar conta" : `Cadastrar conta: ${house.name}`,
      field("s-name", "Conta", name), field("s-day", "Vence todo dia", day),
      h("p", { className: "muted hint" }, "Em meses mais curtos, vale o último dia do mês."),
      h("div", { className: "actions" }, button, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    button.addEventListener("click", () => whileDisabled(button, async () => {
      const entry = { id: bill?.id, name: name.value, day: Number(day.value), until: bill?.until || "" };
      await save(bill ? list.map((x) => (x.id === bill.id ? entry : x)) : [...list, entry], "Conta salva.");
      dialog.close();
    }));
    name.focus();
  }

  /** A text input with a list of suggestions right under it, as wide as the field: it shows the ones that contain
   *  what was typed (all of them when empty); click, or ↑ ↓ and Enter, picks one. Returns the element to put in the form. */
  function autocomplete(input, options) {
    const list = h("ul", { className: "suggestions", role: "listbox", hidden: true });
    let active = -1;
    const items = () => [...list.children];
    const mark = (n) => {
      active = n;
      items().forEach((li, i) => li.classList.toggle("active", i === n));
    };
    const close = () => { list.hidden = true; mark(-1); };
    const pick = (name) => { input.value = name; close(); };
    const open = () => {
      const typed = input.value.trim().toLowerCase();
      const found = options.filter((o) => o.toLowerCase().includes(typed) && o.toLowerCase() !== typed);
      list.replaceChildren(...found.map((o) => h("li", { role: "option",
        onmousedown: (e) => { e.preventDefault(); pick(o); } }, o)));      // mousedown: before the input loses focus
      list.hidden = found.length === 0;
      mark(-1);
    };
    input.addEventListener("focus", open);
    input.addEventListener("input", open);
    input.addEventListener("blur", close);
    input.addEventListener("keydown", (e) => {
      const n = items().length;
      if (list.hidden || n === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        mark((active + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
      } else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items()[active].textContent); }
      else if (e.key === "Escape") { e.stopPropagation(); close(); }          // not the dialog
    });
    return h("div", { className: "autocomplete" }, input, list);
  }

  /** Registers (or edits) the payment of a recurring bill. `preset` {name, due}: paying a bill of the list, its name
   *  is fixed; without it the name is typed (the ones used before are suggested). `month`: the month on screen, the
   *  one the payment refers to when it is paid on another date (a late bill paid next month). */
  function recurringDialog(house, payment, preset, month) {
    const names = [...new Map([...house.recurring_bills.map((b) => b.name),
      ...lastView.expenses.filter((e) => e.category === "recurring").map((e) => e.description)]
      .map((n) => [n.toLowerCase(), n])).values()];
    const date = dateInput({ id: "r-date" }, payment?.date || today());
    const description = h("input", { id: "r-description", maxLength: 120, value: payment?.description || preset?.name || "",
      placeholder: "Ex.: Energia, Água, Internet", autocomplete: "off", readOnly: Boolean(preset) });
    const reference = payment ? refOf(payment) : month;
    const amount = h("input", { id: "r-amount", inputMode: "decimal", placeholder: "0,00",
      value: payment ? centsToText(payment.amount_cents) : "" });
    const paidBy = paidBySelect("r-paid-by", payment ? payment.paid_by || ctx.members[0].id : ctx.me);
    const save = h("button", { className: "primary" }, "Salvar");
    const dialog = openDialog(payment ? "Editar pagamento" : preset ? `Pagar ${preset.name}` : `Lançar pagamento: ${house.name}`,
      preset?.due && h("p", { className: "muted" }, `Vencimento: ${formatDate(preset.due)}`),
      field("r-description", "Conta", preset ? description : autocomplete(description, names)),
      h("div", { className: "two-columns" },
        h("div", {}, field("r-date", "Pago em", date)), h("div", {}, field("r-amount", "Valor (R$)", amount))),
      paidBy && field("r-paid-by", "Pago por", paidBy),
      h("p", { className: "muted hint" }, `Conta de ${monthName(reference)}.`),
      h("div", { className: "actions" }, save, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    save.addEventListener("click", () => whileDisabled(save, async () => {
      try {
        const body = { category: "recurring", date: dateValue(date, "Pago em"), reference,
          description: description.value, amount_cents: cents(amount, "Valor"), paid_by: paidBy ? paidBy.value : "" };
        const view = payment ? await api("PUT", `/houses/${house.id}/expenses/${payment.id}`, body)
          : await api("POST", `/houses/${house.id}/expenses`, body);
        notify("Pagamento salvo.");
        dialog.close();
        show(view);
      } catch (error) { notify(error.message, true); }
    }));
    (preset ? amount : description).focus();
  }

  const areaName = (house, id) => house.areas.find((a) => a.id === id)?.name || "";

  function expensesCard(house, expenses, totals) {
    const add = h("button", { className: "primary small", onclick: () => expenseDialog(house, null) }, "Novo custo");
    const remove = async (e) => {
      if (!confirm(`Excluir o custo "${e.description}" (${formatMoney(e.amount_cents)})?`)) return;
      try { show(await api("DELETE", `/houses/${house.id}/expenses/${e.id}`)); notify("Custo excluído."); }
      catch (error) { notify(error.message, true); }
    };
    const rows = expenses.map((e) => h("tr", {},
      h("td", {}, formatDate(e.date)),
      h("td", {}, e.description, e.supplier && h("div", { className: "muted" }, e.supplier),
        ctx.shared && h("div", { className: "muted paid-by" }, `pago por ${memberName(e.paid_by)}`),
        (e.nf_photo_url || e.material_photo_url) && h("div", { className: "photo-links" },
          e.nf_photo_url && h("button", { className: "link", onclick: () => viewPhoto(e.nf_photo_url, `NF: ${e.description}`) }, "Ver NF"),
          e.material_photo_url && h("button", { className: "link",
            onclick: () => viewPhoto(e.material_photo_url, e.description) }, "Ver foto"))),
      h("td", {}, CATEGORIES[e.category] || e.category,
        e.area_id && h("div", { className: "muted" }, areaName(house, e.area_id))),
      h("td", { className: "num" }, formatMoney(e.amount_cents)),
      h("td", {}, actionsMenu(e.description, [
        { text: "Editar", onclick: () => expenseDialog(house, e) },
        { text: "Excluir", danger: true, onclick: () => remove(e) }]))));
    const [body, pager] = pagedRows(rows);
    return h("div", { className: "card" },
      h("div", { className: "row" }, h("h2", {}, "Custos da reforma"), add),
      expenses.length === 0 ? h("p", { className: "muted" }, "Lance aqui cada compra de material, mão de obra ou serviço.")
        : [h("div", { className: "table-scroll" }, h("table", { className: "money", id: "expenses" },
          h("thead", {}, h("tr", {}, ["Data", "Descrição", "Categoria", "Valor", ""].map((c) => h("th", { className: c === "Valor" ? "num" : null }, c)))),
          body,
          h("tfoot", {}, h("tr", {}, h("td", { colSpan: 3 }, `Total da reforma (${expenses.length})`),
            h("td", { className: "num" }, formatMoney(totals.renovation_cents)), h("td", {}))))),
        pager]);
  }

  // ------------------------------------------------------------------ partners
  /** The Sócios tab, in two cards: who the partners are (and the invites waiting), and how much each one
   *  put in. Partners are all equal: any of them invites by phone, cancels an invite and removes another
   *  partner (except whoever registered the house, where its data is kept). */
  function partnersCard(view) {
    const { house } = view;
    const card = h("div", { className: "card", id: "partners" }, h("h2", {}, "Sócios"));
    const removePartner = async (member) => {
      if (!confirm(`Remover ${memberName(member.id)} dos sócios desta casa?`)) return;
      try { show(await api("DELETE", `/houses/${house.id}/partners/${member.id}`)); notify("Sócio removido."); }
      catch (error) { notify(error.message, true); }
    };
    const cancelInvite = async (invite) => {
      try { show(await api("DELETE", `/houses/${house.id}/invites/${invite.id}`)); notify("Convite cancelado."); }
      catch (error) { notify(error.message, true); }
    };
    if (!ctx.shared) {
      card.append(h("p", { className: "muted" }, "Nenhum sócio. Quem entrar como sócio depois da compra não tem parte "
        + "nela: o que ele pagar entra pelas prestações e pela reforma."));
    } else {
      // one line per partner: the name, the phone below; the ones invited say since when they are waiting
      card.append(h("ul", { className: "members" }, view.members.map((m) => h("li", { className: m.role === "invited" ? "pending" : null },
        h("div", {},
          h("strong", {}, m.id === ctx.me ? `${m.name || "Você"} (você)` : m.name || formatPhone(m.phone)),
          h("div", { className: "muted" }, [m.name && formatPhone(m.phone), m.role === "invited"
            && `convidado em ${formatDate(house.invites.find((i) => i.id === m.id)?.date || "")}, aguardando resposta`]
            .filter(Boolean).join(" · "))),
        m.role === "partner" && m.id !== ctx.me
          && h("button", { className: "link danger-link", onclick: () => removePartner(m) }, "Remover"),
        m.role === "invited" && h("button", { className: "link danger-link", onclick: () => cancelInvite(m) }, "Cancelar convite")))));
    }

    // the invite form: any partner invites
    const phone = h("input", { id: "p-phone", type: "tel", inputMode: "numeric", maxLength: 11, placeholder: "11987654321",
      autocomplete: "off" });
    const send = h("button", { className: "primary small", type: "submit" }, "Convidar");
    const form = h("form", { className: "invite-form" },
      h("label", { htmlFor: "p-phone" }, "Convidar sócio (celular: DDD + número)"),
      h("div", { className: "inline-add" }, phone, send));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      whileDisabled(send, async () => {
        try {
          show(await api("POST", `/houses/${house.id}/invites`, { phone: phone.value.trim() }));
          notify("Convite enviado. Ele aparece para a pessoa quando ela entrar no sistema.");
        } catch (error) { notify(error.message, true); }
      });
    });
    card.append(form);
    return card;
  }

  /** How much each partner put in so far: their part of the purchase, the installments and the renovation
   *  costs they paid, and the total. Only for a house with partners. */
  function investmentCard(view) {
    const { totals } = view;
    if (!ctx.shared) return null;
    const invested = totals.by_member.reduce((sum, r) => sum + r.total_cents, 0);
    return h("div", { className: "card", id: "investment" }, h("h2", {}, "Investimento por sócio"),
      h("div", { className: "table-scroll" }, h("table", { className: "money", id: "by-member" },
        h("thead", {}, h("tr", {}, ["Sócio", "Compra", "Prestações", "Reforma", "Recorrentes", "Total", ""].map((c, i) =>
          h("th", { className: i > 0 && i < 6 ? "num" : null }, c)))),
        // data-label: on a phone each partner is a block, the label next to each amount (style.css)
        h("tbody", {}, totals.by_member.map((r) => h("tr", {},
          h("td", {}, memberName(r.member_id)),
          h("td", { className: "num", "data-label": "Compra" }, formatMoney(r.purchase_cents)),
          h("td", { className: "num", "data-label": "Prestações" }, formatMoney(r.installments_cents)),
          h("td", { className: "num", "data-label": "Reforma" }, formatMoney(r.renovation_cents)),
          h("td", { className: "num", "data-label": "Recorrentes" }, formatMoney(r.recurring_cents)),
          h("td", { className: "num" }, h("strong", {}, formatMoney(r.total_cents))),
          h("td", { className: "num muted" }, percent(r.total_cents, invested))))),
        h("tfoot", {}, h("tr", {}, h("td", {}, "Total pago"),
          ...[["purchase_cents", "Compra"], ["installments_cents", "Prestações"], ["renovation_cents", "Reforma"],
            ["recurring_cents", "Recorrentes"], ["total_cents", null]].map(([k, label]) =>
            h("td", { className: "num", "data-label": label }, formatMoney(totals.by_member.reduce((sum, r) => sum + r[k], 0)))),
          h("td", {}))))),
      h("p", { className: "muted hint" }, "Compra: o que cada um pagou no ato da compra, definido no cadastro da casa. "
        + "Prestações e reforma: o que cada um pagou, conforme o “pago por” de cada lançamento."));
  }

  /** "Pago por": a select of the house's members (only when it has partners), the user first by default. */
  const paidBySelect = (id, current) => ctx.shared
    && select(id, ctx.members.map((m) => [m.id, memberName(m.id)]), current || ctx.me);

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

  // ------------------------------------------------------------------ the house form (a page, one thing at a time)
  /** Register (house = null) or edit a house, as a page with one responsibility per step:
   *  1. the house's data (name, address, date, situation), 2. the areas to renovate, 3. the value (price,
   *  costs of buying it, profit wanted, notes). Registering, a step "Casas desta compra" follows: another house
   *  can be added (it asks for everything again) and, last, the payment: how it is paid, the entrada, the
   *  installments and who bought it. Editing goes from the value straight to how it is paid. */
  function houseForm(house, defaults = {}) {
    const editing = Boolean(house);
    const draftOf = (x) => ({ name: x.name, address: x.address, status: x.status, areas: x.areas.map((a) => a.name),
      price: centsToText(x.purchase_price_cents), costs: x.purchase_costs_cents ? centsToText(x.purchase_costs_cents) : "",
      profit: x.target_profit_percent ? percentText(x.target_profit_percent) : "", notes: x.notes });
    const blank = () => ({ name: "", address: "", status: "renovating", areas: [], price: "", costs: "", notes: "",
      profit: defaults.default_profit_percent ? percentText(defaults.default_profit_percent) : "" });
    const drafts = [editing ? draftOf(house) : blank()];
    const deal = { date: house?.purchase_date || today(), type: house?.payment_type || "cash",
      down: house?.down_payment_cents ? centsToText(house.down_payment_cents) : "", count: "", amount: "", first: "",
      firstTyped: false, buyers: "me", ownerShare: "", partners: [{ phone: "", cents: "" }] };
    deal.first = addMonth(deal.date);
    let current = 0;                       // the house being filled in
    let step = "dados";                    // dados · reforma · valor · casas · pagamento

    const back = () => (editing ? detail(house.id) : list());
    const bind = (input, object, key) => { input.addEventListener("input", () => { object[key] = input.value; }); return input; };
    const money = (text, label, required = true) => {      // "1.234,56" -> cents, or throws with the field's name
      if (!required && !text.trim()) return 0;
      const value = toCents(text);
      if (value === null) throw new Error(`${label}: informe um valor como 1.234,56`);
      return value;
    };
    const houseLabel = (x, i) => x.name.trim() || `Casa ${i + 1}`;
    const go = (next) => { step = next; draw(); window.scrollTo(0, 0); };
    /** Another house of the same deal (same date and payment): it asks for all its data again. */
    const addAnother = () => { drafts.push({ ...blank(), profit: drafts[0].profit }); current = drafts.length - 1; go("dados"); };

    function header() {
      // every step is always there; editing opens any of them at once, a new house goes one by one (Continuar / Voltar)
      const all = [["dados", "Dados"], ["reforma", "Reforma"], ["valor", "Valor"], ["casas", "Casas"], ["pagamento", "Pagamento"]]
        .filter(([key]) => key !== "casas" || (!editing && drafts.length > 1));
      const stepper = h("ol", { className: "stepper", "aria-label": "Passos do cadastro" }, all.map(([key, label]) =>
        h("li", { className: key === step ? "current" : null, "aria-current": key === step ? "step" : null },
          editing ? h("button", { type: "button", className: "step-button", onclick: () => go(key) }, label)
            : h("span", { className: "step-button" }, label))));
      const many = drafts.length > 1;
      return [h("button", { className: "link back", onclick: back }, editing ? `‹ ${house.name}` : "‹ Casas"),
        h("h1", {}, editing ? `Editar ${house.name}` : "Nova casa"),
        ["dados", "reforma", "valor"].includes(step) && !editing && many
          && h("p", { className: "muted", id: "h-which" }, `Casa ${current + 1} de ${drafts.length}: ${houseLabel(drafts[current], current)}`),
        stepper];
    }

    // ---- 1. the house's data
    function stepData() {
      const d = drafts[current];
      const name = bind(h("input", { id: "h-name", maxLength: 80, value: d.name, placeholder: "Ex.: Casa da Rua das Flores" }), d, "name");
      const address = bind(h("input", { id: "h-address", maxLength: 200, value: d.address }), d, "address");
      const status = select("h-status", STATUS, d.status);
      status.addEventListener("change", () => { d.status = status.value; });
      const date = dateInput({ id: "h-date" }, deal.date);
      date.addEventListener("input", () => { deal.date = date.iso; if (!deal.firstTyped) deal.first = addMonth(date.iso); });
      const next = h("button", { className: "primary", id: "h-next" }, "Continuar: pontos de reforma");
      next.onclick = () => {
        if (!d.name.trim()) return notify("Nome: preencha este campo", true);
        if (!d.address.trim()) return notify("Endereço: preencha este campo", true);
        if (!deal.date) return notify("Data da compra: informe a data como dd/mm/aaaa", true);
        go("reforma");
      };
      return h("div", { className: "card form-step" }, h("h2", {}, "Dados da casa"),
        field("h-name", "Nome", name), field("h-address", "Endereço", address),
        h("div", { className: "two-columns" },
          current === 0 ? h("div", {}, field("h-date", "Data da compra", date)) : h("div", {}, h("p", { className: "muted hint" },
            `Data da compra: ${formatDate(deal.date)}, a mesma da primeira casa.`)),
          h("div", {}, field("h-status", "Situação", status))),
        h("div", { className: "actions" }, next));
    }

    // ---- 2. the areas that need renovation
    function stepAreas() {
      const d = drafts[current];
      const chips = h("div", { className: "chips", id: "h-areas" });
      const addChip = (name) => {
        const input = h("input", { type: "checkbox", value: name, checked: d.areas.some((a) => a.toLowerCase() === name.toLowerCase()) });
        input.addEventListener("change", () => {
          d.areas = input.checked ? [...d.areas, name] : d.areas.filter((a) => a.toLowerCase() !== name.toLowerCase());
        });
        chips.append(h("label", { className: "chip" }, input, name));
      };
      const known = (name) => [...chips.querySelectorAll("input")].some((i) => i.value.toLowerCase() === name.toLowerCase());
      for (const name of d.areas) addChip(name);
      for (const name of AREA_SUGGESTIONS) if (!known(name)) addChip(name);
      const other = h("input", { id: "h-other-area", maxLength: 40, placeholder: "Outra área (ex.: Edícula)" });
      const addOther = () => {
        const name = other.value.trim().replace(/\s+/g, " ");
        if (!name) return;
        const existing = [...chips.querySelectorAll("input")].find((i) => i.value.toLowerCase() === name.toLowerCase());
        if (existing) { if (!existing.checked) { existing.checked = true; existing.dispatchEvent(new Event("change")); } }
        else { d.areas = [...d.areas, name]; addChip(name); chips.lastChild.querySelector("input").checked = true; }
        other.value = "";
        other.focus();
      };
      other.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addOther(); } });
      return h("div", { className: "card form-step" }, h("h2", {}, "Pontos de reforma"),
        h("p", { className: "muted hint" }, "Marque as partes da casa que precisam de reforma. Cada custo da obra pode ser ligado a uma delas."),
        chips,
        h("div", { className: "inline-add" }, other, h("button", { type: "button", className: "secondary small", onclick: addOther }, "Adicionar")),
        h("div", { className: "actions" },
          h("button", { className: "secondary", onclick: () => go("dados") }, "Voltar"),
          h("button", { className: "primary", id: "h-next", onclick: () => go("valor") }, "Continuar: valor")));
    }

    // ---- 3. the value
    function stepValue() {
      const d = drafts[current];
      const price = bind(h("input", { id: "h-price", inputMode: "decimal", placeholder: "0,00", value: d.price }), d, "price");
      const costs = bind(h("input", { id: "h-costs", inputMode: "decimal", placeholder: "0,00", value: d.costs }), d, "costs");
      const profit = bind(h("input", { id: "h-profit", inputMode: "decimal", placeholder: "Ex.: 30", value: d.profit }), d, "profit");
      const notes = h("textarea", { id: "h-notes", maxLength: 2000, rows: 3, value: d.notes });
      notes.addEventListener("input", () => { d.notes = notes.value; });
      const last = editing ? "Continuar: pagamento" : "Continuar: pagamento";
      const validAnd = (action) => {
        try {
          money(d.price, "Valor do imóvel");
          money(d.costs, "Custos da compra", false);
          if (toPercent(d.profit) === null) throw new Error("Lucro desejado: informe um percentual como 30 ou 12,5");
          action();
        } catch (error) { notify(error.message, true); }
      };
      const next = h("button", { className: "primary", id: "h-next" }, last);
      next.onclick = () => {
        try {
          money(d.price, "Valor do imóvel");
          money(d.costs, "Custos da compra", false);
          if (toPercent(d.profit) === null) throw new Error("Lucro desejado: informe um percentual como 30 ou 12,5");
          go(drafts.length > 1 ? "casas" : "pagamento");
        } catch (error) { notify(error.message, true); }
      };
      return h("div", { className: "card form-step" }, h("h2", {}, "Valor"),
        h("div", { className: "two-columns" },
          h("div", {}, field("h-price", "Valor do imóvel (R$)", price)),
          h("div", {}, field("h-costs", "Custos da compra (R$)", costs))),
        h("p", { className: "muted hint" }, "Custos da compra: ITBI, escritura, registro, comissão do corretor, certidões…"),
        field("h-profit", "Lucro desejado (%)", profit),
        h("p", { className: "muted hint" }, "Sobre o total investido (compra + reforma): a página da casa mostra por quanto vender hoje."),
        field("h-notes", "Observações", notes),
        h("div", { className: "actions" }, h("button", { className: "secondary", onclick: () => go("reforma") }, "Voltar"), next,
          !editing && h("button", { className: "secondary", id: "h-add-here", onclick: () => validAnd(addAnother) },
            "Comprei outra casa nesta negociação")));
    }

    // ---- the houses of this purchase (registering only)
    function stepHouses() {
      const total = drafts.reduce((sum, d) => sum + (toCents(d.price) || 0), 0);
      const rows = drafts.map((d, i) => h("li", {},
        h("div", {}, h("strong", {}, houseLabel(d, i)), h("div", { className: "muted" }, [d.address,
          `${formatMoney(toCents(d.price) || 0)}`, d.areas.length && `${d.areas.length} ponto(s) de reforma`].filter(Boolean).join(" · "))),
        h("div", { className: "actions tight" },
          h("button", { type: "button", className: "link", onclick: () => { current = i; go("dados"); } }, "Editar"),
          drafts.length > 1 && h("button", { type: "button", className: "link danger-link",
            onclick: () => { drafts.splice(i, 1); current = 0; draw(); } }, "Tirar"))));
      const another = h("button", { className: "secondary", id: "h-add-more", onclick: addAnother }, "+ Outra casa nesta negociação");
      return h("div", { className: "card form-step" }, h("h2", {}, drafts.length > 1 ? "Casas desta negociação" : "Casas desta negociação"),
        h("ul", { className: "members", id: "h-houses" }, rows),
        drafts.length > 1 && h("p", { className: "muted hint" }, `Total dos imóveis: ${formatMoney(total)}. A entrada e as parcelas serão `
          + "informadas uma vez só, para todas as casas, e divididas pelo valor de cada imóvel."),
        h("p", { className: "muted hint" }, "Comprou mais de uma casa de uma vez? Adicione cada uma: ela pede todos os dados de novo."),
        h("div", { className: "actions" }, another,
          h("button", { className: "primary", id: "h-next", onclick: () => go("pagamento") }, "Continuar: pagamento")));
    }

    // ---- last: how it is paid
    function stepPayment() {
      const deals = drafts.length > 1;
      const radio = (value, text) => h("label", { className: "choice" },
        h("input", { type: "radio", name: "h-payment", value, checked: value === deal.type,
          onchange: () => { deal.type = value; installments.hidden = value !== "installments"; updateSummary(); updateSplit(); } }), text);
      const down = bind(h("input", { id: "h-down", inputMode: "decimal", placeholder: "0,00", value: deal.down }), deal, "down");
      const count = bind(h("input", { id: "h-count", type: "number", min: 1, max: 600, inputMode: "numeric", placeholder: "Ex.: 120",
        value: deal.count }), deal, "count");
      const amount = bind(h("input", { id: "h-amount", inputMode: "decimal", placeholder: "0,00", value: deal.amount }), deal, "amount");
      const first = dateInput({ id: "h-first" }, deal.first);
      first.addEventListener("input", () => { deal.first = first.iso; deal.firstTyped = true; });
      const summary = h("p", { className: "muted hint", id: "h-summary" });
      const shares = h("p", { className: "muted hint", id: "h-bundle-note" });
      const prices = () => drafts.map((d) => toCents(d.price) || 0);
      const installments = h("div", { className: "installments-fields" },
        h("div", { className: "two-columns" },
          h("div", {}, field("h-down", deals ? "Entrada total (R$)" : "Entrada (R$)", down)),
          !editing && [
            h("div", {}, field("h-count", "Quantidade de parcelas", count)),
            h("div", {}, field("h-amount", deals ? "Valor total de cada parcela (R$)" : "Valor de cada parcela (R$)", amount)),
            h("div", {}, field("h-first", "Data da primeira parcela", first))]),
        editing ? h("p", { className: "muted hint" }, "As prestações são alteradas na página da casa.") : [summary, shares]);
      function updateSummary() {          // "Entrada R$ 60.000,00 + 120 × R$ 2.000,00 = R$ 300.000,00"
        const n = Number(deal.count), each = toCents(deal.amount), entrada = toCents(deal.down || "0");
        summary.textContent = n > 0 && each !== null && entrada !== null
          ? `Entrada ${formatMoney(entrada)} + ${n} × ${formatMoney(each)} = ${formatMoney(entrada + n * each)}` : "";
        const sum = prices().reduce((a, b) => a + b, 0);
        shares.textContent = !deals || sum === 0 ? "" : "Dividido pelo valor de cada imóvel: "
          + drafts.map((d, i) => `${houseLabel(d, i)} ${percentText(Math.round((10000 * prices()[i]) / sum) / 100)} %`).join(" · ") + ".";
      }
      for (const input of [down, count, amount]) input.addEventListener("input", updateSummary);
      updateSummary();

      // who bought it: only for one house, registering: the split is set here, in the act of buying
      const buyersType = (value, text) => h("label", { className: "choice" },
        h("input", { type: "radio", name: "h-buyers", value, checked: value === deal.buyers,
          onchange: () => { deal.buyers = value; buyersBox.hidden = value !== "partners"; updateSplit(); } }), text);
      const ownerShare = bind(h("input", { id: "h-owner-share", inputMode: "decimal", placeholder: "0,00", value: deal.ownerShare }), deal, "ownerShare");
      const partnerRows = h("div", { id: "h-partners" });
      const split = h("p", { className: "muted hint", id: "h-split" });
      const drawPartners = () => partnerRows.replaceChildren(...deal.partners.map((p, i) => {
        const phone = bind(h("input", { className: "p-phone", type: "tel", inputMode: "numeric", maxLength: 11, placeholder: "Celular",
          "aria-label": "Celular do sócio (DDD + número)", value: p.phone }), p, "phone");
        const cents = bind(h("input", { className: "p-cents", inputMode: "decimal", placeholder: "Valor (R$)",
          "aria-label": "Quanto o sócio pagou (R$)", value: p.cents }), p, "cents");
        cents.addEventListener("input", updateSplit);
        return h("div", { className: "partner-row" }, phone, cents, h("button", { type: "button", className: "link danger-link",
          "aria-label": "Tirar este sócio", onclick: () => { deal.partners.splice(i, 1); drawPartners(); updateSplit(); } }, "✕"));
      }));
      function updateSplit() {         // "Pago na compra R$ 318.000,00 · divisão: faltam R$ 18.000,00"
        // paid at the purchase of every house of the deal: the cash prices or the (one) entrada, plus the costs
        const paid = deal.type === "installments" ? toCents(deal.down || "0")
          : drafts.reduce((sum, d) => (sum === null || toCents(d.price || "0") === null ? null : sum + toCents(d.price || "0")), 0);
        const costs = drafts.reduce((sum, d) => (sum === null || toCents(d.costs || "0") === null ? null : sum + toCents(d.costs || "0")), 0);
        const total = paid === null || costs === null ? null : paid + costs;
        const parts = [deal.ownerShare, ...deal.partners.map((p) => p.cents)].map((v) => toCents(v || "0"));
        if (!total || parts.some((v) => v === null)) { split.textContent = ""; return; }
        const sum = parts.reduce((a, b) => a + b, 0);
        split.textContent = `Pago na compra: ${formatMoney(total)} · `
          + (sum === total ? "a divisão fecha." : `${sum < total ? "faltam" : "passam"} ${formatMoney(Math.abs(total - sum))}.`);
      }
      const buyersBox = h("div", { className: "installments-fields buyers-fields", hidden: deal.buyers !== "partners" },
        field("h-owner-share", "Sua parte na compra (R$)", ownerShare),
        h("label", {}, "Sócios: celular e quanto cada um pagou na compra"), partnerRows,
        h("button", { type: "button", className: "secondary small",
          onclick: () => { deal.partners.push({ phone: "", cents: "" }); drawPartners(); partnerRows.lastChild.querySelector(".p-phone").focus(); } }, "+ Sócio"),
        split,
        h("p", { className: "muted hint" }, deals
          ? "Informe quanto cada um pagou no total (entrada + custos de todas as casas): a parte de cada um é dividida entre as casas. "
            + "Cada sócio recebe um convite em cada casa."
          : "Cada sócio recebe um convite no celular. A divisão da compra é definida só aqui, no cadastro."));
      drawPartners();
      for (const input of [ownerShare]) input.addEventListener("input", updateSplit);
      updateSplit();
      installments.hidden = deal.type !== "installments";

      const save = h("button", { className: "primary", id: "h-save" }, editing ? "Salvar" : deals ? "Salvar as casas" : "Salvar casa");
      save.addEventListener("click", () => whileDisabled(save, async () => {
        try {
          const target = (d) => {
            const value = toPercent(d.profit);
            if (value === null) throw new Error("Lucro desejado: informe um percentual como 30 ou 12,5");
            return value;
          };
          const data = (d) => ({ name: d.name, address: d.address, status: d.status, notes: d.notes,
            purchase_price_cents: money(d.price, "Valor do imóvel"), purchase_costs_cents: money(d.costs, "Custos da compra", false),
            target_profit_percent: target(d), areas: d.areas });
          const body = { ...data(drafts[0]), purchase_date: deal.date, payment_type: deal.type };
          if (deal.type === "installments") {
            body.down_payment_cents = money(deal.down, "Entrada", false);
            if (!editing) {
              if (!(Number(deal.count) >= 1)) throw new Error("Quantidade de parcelas: informe quantas são");
              body.installments = { count: Number(deal.count), amount_cents: money(deal.amount, "Valor de cada parcela"),
                first_due_date: dateValue(first, "Data da primeira parcela") };
            }
          }
          if (!editing && deals) body.also_bought = drafts.slice(1).map(data);
          if (!editing && deal.buyers === "partners") {
            body.owner_share_cents = money(deal.ownerShare, "Sua parte na compra", false);
            body.partners = deal.partners.map((p) => ({ phone: p.phone.trim(), cents: money(p.cents, "Quanto o sócio pagou", false) }));
            if (body.partners.length === 0) throw new Error("Sócios: adicione ao menos um, ou marque “Só eu”");
          }
          const view = editing ? await api("PUT", `/houses/${house.id}`, body) : await api("POST", "/houses", body);
          notify(deals ? "Casas salvas." : "Casa salva.");
          show(view);
        } catch (error) { notify(error.message, true); }
      }));

      return h("div", { className: "card form-step" }, h("h2", {}, "Pagamento"),
        deals && h("p", { className: "muted hint" }, `Compra de ${drafts.length} casas (${formatMoney(prices().reduce((a, b) => a + b, 0))}): `
          + "a entrada e as parcelas abaixo valem para todas juntas."),
        h("fieldset", { className: "choices" }, h("legend", {}, "Forma de pagamento"),
          radio("cash", "À vista"), radio("installments", "Parcelado")),
        installments,
        !editing && [h("fieldset", { className: "choices" }, h("legend", {}, "Quem comprou"),
          buyersType("me", "Só eu"), buyersType("partners", "Com sócios")), buyersBox],
        h("div", { className: "actions" }, h("button", { className: "secondary", onclick: () => go(drafts.length > 1 ? "casas" : "valor") }, "Voltar"), save));
    }

    function draw() {
      const body = { dados: stepData, reforma: stepAreas, valor: stepValue, casas: stepHouses, pagamento: stepPayment }[step]();
      render(container, header(), body);
      container.querySelector("input:not([type=checkbox]):not([type=radio]), textarea")?.focus();
    }
    draw();
  }

  function expenseDialog(house, expense) {
    const date = dateInput({ id: "e-date" }, expense?.date || today());
    const category = select("e-category", CATEGORIES, expense?.category || "material");
    const description = h("input", { id: "e-description", maxLength: 120, value: expense?.description || "",
      placeholder: "Ex.: Cimento e areia" });
    const supplier = h("input", { id: "e-supplier", maxLength: 80, value: expense?.supplier || "" });
    const amount = h("input", { id: "e-amount", inputMode: "decimal", placeholder: "0,00",
      value: expense ? centsToText(expense.amount_cents) : "" });
    const area = select("e-area", [["", "Sem área"], ...house.areas.map((a) => [a.id, a.name])], expense?.area_id || "");
    const paidBy = paidBySelect("e-paid-by", expense ? expense.paid_by || ctx.members[0].id : ctx.me);
    const nfPhoto = photoField("e-nf", "Foto da NF", expense?.nf_photo, expense?.nf_photo_url);
    const materialPhoto = photoField("e-material", "Foto do material ou serviço", expense?.material_photo,
      expense?.material_photo_url);
    const save = h("button", { className: "primary" }, "Salvar");
    const dialog = openDialog(expense ? "Editar custo" : `Novo custo: ${house.name}`,
      field("e-description", "Descrição", description),
      h("div", { className: "two-columns" },
        h("div", {}, field("e-date", "Data", date)), h("div", {}, field("e-category", "Categoria", category)),
        h("div", {}, field("e-amount", "Valor (R$)", amount)), h("div", {}, field("e-supplier", "Fornecedor (opcional)", supplier))),
      house.areas.length > 0 ? field("e-area", "Área da casa", area)
        : h("p", { className: "muted hint" }, "Para vincular o custo a uma área (cozinha, telhado…), marque as áreas em “Editar casa”."),
      paidBy && field("e-paid-by", "Pago por", paidBy),
      h("div", { className: "two-columns photo-fields" }, nfPhoto.element, materialPhoto.element),
      h("div", { className: "actions" }, save, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    save.addEventListener("click", () => whileDisabled(save, async () => {
      try {
        const body = { date: dateValue(date, "Data"), category: category.value, description: description.value,
          supplier: supplier.value, amount_cents: cents(amount, "Valor"), area_id: area.value,
          paid_by: paidBy ? paidBy.value : "" };
        save.textContent = "Enviando fotos…";
        body.nf_photo = await nfPhoto.id(house);
        body.material_photo = await materialPhoto.id(house);
        save.textContent = "Salvar";
        const view = expense ? await api("PUT", `/houses/${house.id}/expenses/${expense.id}`, body)
          : await api("POST", `/houses/${house.id}/expenses`, body);
        notify("Custo salvo.");
        dialog.close();
        show(view);
      } catch (error) { save.textContent = "Salvar"; notify(error.message, true); }
    }));
    description.focus();
  }

  /** One photo in a form: the one there is (tap to see it), choose another (camera or gallery) or remove
   *  it. `id(house)` gives the photo's id when saving: sends the chosen one first, "" if removed. */
  function photoField(id, label, currentId = "", currentUrl = "") {
    let chosen = null, keep = Boolean(currentId);
    const preview = h("img", { className: "photo-thumb", alt: label, hidden: !currentUrl, src: currentUrl || null,
      onclick: () => viewPhoto(preview.src, label) });
    // the file input itself is hidden (its text follows the browser's language): a button-like label opens it
    const input = h("input", { id, type: "file", accept: "image/*", className: "visually-hidden" });
    const pick = h("label", { htmlFor: id, className: "file-button" }, currentUrl ? "Trocar foto" : "Escolher foto");
    const remove = h("button", { type: "button", className: "link danger-link", hidden: !currentUrl }, "Remover");
    input.addEventListener("change", () => {
      chosen = input.files[0] || null;
      if (!chosen) return;
      if (preview.src.startsWith("blob:")) URL.revokeObjectURL(preview.src);
      preview.src = URL.createObjectURL(chosen);
      preview.hidden = remove.hidden = false;
      pick.textContent = "Trocar foto";
    });
    remove.addEventListener("click", () => {
      chosen = null; keep = false; input.value = "";
      preview.hidden = remove.hidden = true;
      preview.removeAttribute("src");
      pick.textContent = "Escolher foto";
    });
    const element = h("div", { className: "photo-field" }, h("span", { className: "field-label" }, label), preview,
      h("div", { className: "photo-actions" }, input, pick, remove));
    return { element, id: async (house) => (chosen ? uploadPhoto(house.id, chosen) : keep ? currentId : "") };
  }

  // ------------------------------------------------------------------ timeline
  /** The house's story in photos, from the purchase to the end: oldest first, a page of 10 moments at a
   *  time, opening on the latest page. Each moment: its date, what it shows and its photos. */
  function timelineCard(house, timeline) {
    const add = h("button", { className: "primary small", onclick: () => timelineDialog(house, null) }, "Adicionar fotos");
    const card = h("div", { className: "card", id: "timeline" }, h("div", { className: "row" }, h("h2", {}, "Timeline"), add));
    if (timeline.length === 0) {
      card.append(h("p", { className: "muted" }, "Registre aqui a evolução da casa, desde a compra até a conclusão: "
        + "a data, o que mudou e as fotos."));
      return card;
    }
    const remove = async (entry) => {
      if (!confirm(`Excluir o registro de ${formatDate(entry.date)} e suas ${entry.photos.length} foto(s)?`)) return;
      try { show(await api("DELETE", `/houses/${house.id}/timeline/${entry.id}`)); notify("Registro excluído."); }
      catch (error) { notify(error.message, true); }
    };
    const rows = timeline.map((entry) => h("article", { className: "moment" },
      h("div", { className: "moment-head" },
        h("div", {}, h("strong", {}, formatDate(entry.date)), entry.caption && h("p", {}, entry.caption)),
        actionsMenu(`registro de ${formatDate(entry.date)}`, [
          { text: "Editar", onclick: () => timelineDialog(house, entry) },
          { text: "Excluir", danger: true, onclick: () => remove(entry) }])),
      h("div", { className: "thumbs" }, entry.photo_urls.map((url, i) => h("img", {
        className: "photo-thumb", src: url, alt: `${entry.caption || formatDate(entry.date)} (${i + 1})`, loading: "lazy",
        onclick: () => viewPhoto(url, `${formatDate(entry.date)}${entry.caption ? ` · ${entry.caption}` : ""}`) })))));
    const [list, pager] = pagedRows(rows, { start: Math.ceil(rows.length / PAGE_SIZE) - 1, tag: "div" });
    card.append(list, pager);
    return card;
  }

  /** A moment of the timeline: its date, what it shows, the photos it has (each can be removed) and
   *  new ones (several at once). */
  function timelineDialog(house, entry) {
    const date = dateInput({ id: "t-date" }, entry?.date || today());
    const caption = h("input", { id: "t-caption", maxLength: 200, value: entry?.caption || "",
      placeholder: "Ex.: Telhado novo instalado" });
    const kept = (entry?.photos || []).map((id, i) => ({ id, url: entry.photo_urls[i] }));
    let chosen = [];
    const thumbs = h("div", { className: "thumbs", id: "t-photos" });
    const input = h("input", { id: "t-files", type: "file", accept: "image/*", multiple: true, className: "visually-hidden" });
    const draw = () => render(thumbs,
      kept.map((photo) => thumb(photo.url, () => { kept.splice(kept.indexOf(photo), 1); draw(); })),
      chosen.map((file) => thumb(file.url, () => { URL.revokeObjectURL(file.url); chosen = chosen.filter((f) => f !== file); draw(); })));
    const thumb = (url, onRemove) => h("div", { className: "thumb-edit" }, h("img", { className: "photo-thumb", src: url, alt: "" }),
      h("button", { type: "button", className: "thumb-remove", "aria-label": "Tirar esta foto", onclick: onRemove }, "✕"));
    input.addEventListener("change", () => {
      chosen = chosen.concat([...input.files].map((file) => Object.assign(file, { url: URL.createObjectURL(file) })));
      input.value = "";
      draw();
    });
    draw();
    const save = h("button", { className: "primary" }, "Salvar");
    const dialog = openDialog(entry ? "Editar registro" : "Novo registro na timeline",
      h("div", { className: "two-columns" },
        h("div", {}, field("t-date", "Data", date)), h("div", {}, field("t-caption", "O que mostra (opcional)", caption))),
      h("span", { className: "field-label" }, "Fotos (até 12)"), thumbs, input,
      h("label", { htmlFor: "t-files", className: "file-button" }, "Escolher fotos"),
      h("div", { className: "actions" }, save, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    save.addEventListener("click", () => whileDisabled(save, async () => {
      try {
        if (kept.length + chosen.length === 0) throw new Error("Fotos: escolha ao menos uma.");
        if (kept.length + chosen.length > 12) throw new Error("Fotos: no máximo 12 por registro.");
        const photos = kept.map((photo) => photo.id);
        for (const [i, file] of chosen.entries()) {
          save.textContent = `Enviando foto ${i + 1} de ${chosen.length}…`;
          photos.push(await uploadPhoto(house.id, file));
        }
        save.textContent = "Salvar";
        const body = { date: dateValue(date, "Data"), caption: caption.value, photos };
        const view = entry ? await api("PUT", `/houses/${house.id}/timeline/${entry.id}`, body)
          : await api("POST", `/houses/${house.id}/timeline`, body);
        notify("Registro salvo.");
        dialog.close();
        show(view);
      } catch (error) { save.textContent = "Salvar"; notify(error.message, true); }
    }));
    (entry ? caption : input).focus();
  }

  /** Adds N monthly installments at once: "120 de R$ 2.500,00, a primeira em 10/02/2026". */
  function planDialog(house, bundle = []) {
    const grouped = bundle.length > 1;
    const count = h("input", { id: "i-count", type: "number", min: 1, max: 600, value: 1, inputMode: "numeric" });
    const amount = h("input", { id: "i-amount", inputMode: "decimal", placeholder: "0,00" });
    const first = dateInput({ id: "i-first" }, today());
    const save = h("button", { className: "primary" }, "Adicionar");
    const dialog = openDialog(`Prestações: ${house.name}`,
      h("div", { className: "two-columns" },
        h("div", {}, field("i-count", "Quantidade", count)), h("div", {}, field("i-amount", grouped ? "Valor total de cada uma (R$)" : "Valor de cada uma (R$)", amount))),
      field("i-first", "Vencimento da primeira", first),
      h("p", { className: "muted hint" }, grouped
        ? `Compra conjunta: o valor é da parcela inteira e é dividido entre as casas (${bundleText(bundle)}).`
        : "Uma por mês, sempre no mesmo dia. Depois dá para editar cada uma (valor, vencimento)."),
      h("div", { className: "actions" }, save, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    save.addEventListener("click", () => whileDisabled(save, async () => {
      try {
        const body = { count: Number(count.value), amount_cents: cents(amount, "Valor de cada uma"), first_due_date: dateValue(first, "Vencimento da primeira") };
        const view = await api("POST", `/houses/${house.id}/installments`, body);
        notify(body.count === 1 ? "Prestação adicionada." : `${body.count} prestações adicionadas.`);
        dialog.close();
        show(view);
      } catch (error) { notify(error.message, true); }
    }));
    amount.focus();
  }

  /** One installment: its due date, its amount and the day it was paid (empty: not paid). */
  function installmentDialog(house, inst, n, grouped = false) {
    grouped = grouped && Boolean(inst.group_id);
    const due = dateInput({ id: "i-due" }, inst.due_date);
    const amount = h("input", { id: "i-value", inputMode: "decimal",
      value: centsToText(grouped ? inst.total_cents : inst.amount_cents) });
    const paid = dateInput({ id: "i-paid" }, inst.paid_date);
    const paidBy = paidBySelect("i-paid-by", inst.paid_date ? inst.paid_by || ctx.members[0].id : ctx.me);
    const save = h("button", { className: "primary" }, "Salvar");
    const dialog = openDialog(`Prestação ${n}`,
      h("div", { className: "two-columns" },
        h("div", {}, field("i-due", "Vencimento", due)), h("div", {}, field("i-value", grouped ? "Valor total (R$)" : "Valor (R$)", amount))),
      grouped && h("p", { className: "muted hint" }, "Compra conjunta: o valor, o vencimento e o pagamento valem para todas as casas "
        + "(o valor é dividido de novo, na mesma proporção)."),
      field("i-paid", "Paga em (vazio se ainda não foi paga)", paid),
      paidBy && field("i-paid-by", "Paga por", paidBy),
      h("div", { className: "actions" }, save, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    save.addEventListener("click", () => whileDisabled(save, async () => {
      try {
        const paidDate = dateValue(paid, "Paga em", false);
        const body = { due_date: dateValue(due, "Vencimento"), amount_cents: grouped ? inst.amount_cents : cents(amount, "Valor"),
          paid_date: paidDate, paid_by: paidDate && paidBy ? paidBy.value : "" };
        if (grouped) body.total_cents = cents(amount, "Valor total");
        const view = await api("PUT", `/houses/${house.id}/installments/${inst.id}`, body);
        notify("Prestação salva.");
        dialog.close();
        show(view);
      } catch (error) { notify(error.message, true); }
    }));
    amount.focus();
  }

  if (params.house) {
    if (params.tab) openTab[params.house] = params.tab;
    detail(params.house);
  } else list();
}
