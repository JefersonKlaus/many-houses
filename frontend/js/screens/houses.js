// Casas: every house with what it cost (purchase + renovation), and each house's page with its purchase
// (price, entrada and the installments being paid), its renovation costs by area and category, the list of
// costs (with photos of the NF and of the material or service), the timeline of photos from the purchase to
// the end and, for a house bought with partners, how much each one put in. Invites to be a partner show up
// on top of the list. Every change answers the house's whole page, which is drawn at once: one request
// per change, never two.
import { api, uploadPhoto } from "../api.js";
import { actionsMenu, centsToText, formatDate, formatMoney, formatPhone, h, notify, openDialog, percent, percentText,
  render, toCents, toPercent, today, viewPhoto, whileDisabled } from "../util.js";
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

export async function mount(container) {
  // ------------------------------------------------------------------ every house
  let showSold = false;        // sold houses are hidden from the list (and its totals) unless asked for

  async function list() {
    let all, invites;
    try { [all, invites] = await Promise.all([api("GET", "/houses"), api("GET", "/invites")]); }
    catch (error) { return render(container, h("p", { className: "notice" }, error.message)); }
    const sold = all.filter((x) => x.status === "sold").length;
    const houses = showSold ? all : all.filter((x) => x.status !== "sold");
    const sum = (key) => houses.reduce((total, x) => total + x.totals[key], 0);
    const row = (x) => h("li", { className: "list-item clickable", tabindex: 0, role: "button",
      onclick: () => detail(x.id), onkeydown: (e) => { if (e.key === "Enter") detail(x.id); } },
    h("div", { className: "list-main" },
      h("div", { className: "list-title" }, h("strong", {}, x.name, badge(x.status),
        (x.role === "partner" || x.partners.length > 0) && h("span", { className: "badge partner" }, "Com sócios")),
        h("strong", { className: "amount" }, formatMoney(x.totals.total_cents))),
      h("div", { className: "list-title muted" }, h("span", {}, x.address),
        h("span", {}, `compra ${formatMoney(x.totals.purchase_cents)} · reforma ${formatMoney(x.totals.renovation_cents)}`,
          x.target_profit_percent > 0 && x.status !== "sold" && ` · vender por ${formatMoney(x.totals.sale.suggested_price_cents)}`))),
    h("span", { className: "chevron", "aria-hidden": "true" }, "›"));
    render(container,
      invites.map(inviteCard),
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
      houseDialog(null, show, defaults);
    });
  }

  /** "(11) 98888-7777 convidou você para ser sócio da casa X": accept (it opens) or decline. */
  function inviteCard(invite) {
    const accept = h("button", { className: "primary small" }, "Aceitar");
    const decline = h("button", { className: "secondary small" }, "Recusar");
    accept.onclick = () => whileDisabled(accept, async () => {
      try {
        const { house_id } = await api("POST", `/invites/${invite.id}/accept`, {});
        notify(`Agora você é sócio de "${invite.house_name}".`);
        detail(house_id);
      } catch (error) { notify(error.message, true); list(); }
    });
    decline.onclick = () => whileDisabled(decline, async () => {
      if (!confirm(`Recusar o convite para a casa "${invite.house_name}"?`)) return;
      try { await api("POST", `/invites/${invite.id}/decline`, {}); notify("Convite recusado."); }
      catch (error) { notify(error.message, true); }
      list();
    });
    return h("div", { className: "card invite", role: "status" },
      h("p", {}, h("strong", {}, invite.from_name || formatPhone(invite.from_phone) || "Alguém"),
        invite.from_name && invite.from_phone && h("span", { className: "muted" }, ` (${formatPhone(invite.from_phone)})`),
        " convidou você para ser sócio da casa ", h("strong", {}, `“${invite.house_name}”`), "."),
      h("p", { className: "muted" }, "Aceitando, a casa aparece na sua lista e vocês lançam juntos os pagamentos."),
      h("div", { className: "actions" }, accept, decline));
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

  function show(view) {
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
          h("button", { className: "secondary", onclick: () => houseDialog(house, show) }, "Editar casa"),
          h("button", { className: "danger", onclick: remove }, "Excluir"))),
      h("div", { className: "totals", id: "house-totals" },
        tile("Compra", formatMoney(totals.purchase_cents)),
        tile("Reforma", formatMoney(totals.renovation_cents), `${totals.expense_count} custo(s)`),
        tile("Total investido", formatMoney(totals.total_cents))),
      saleCard(house, totals),
      tabs(house.id, [
        ["renovation", "Reforma", () => [areasCard(house, totals), categoriesCard(totals), expensesCard(house, expenses, totals)]],
        ["purchase", "Compra", () => [purchaseCard(house, totals.payment)]],
        house.payment_type === "installments" && ["installments",
          `Prestações (${totals.payment.paid_count}/${totals.payment.installments_count})`,
          () => [installmentsCard(house, installments, totals.payment)]],
        ["partners", ctx.shared ? `Sócios (${view.members.length})` : "Sócios", () => [partnersCard(view), investmentCard(view)]],
        ["timeline", view.timeline.length ? `Timeline (${view.timeline.length})` : "Timeline", () => [timelineCard(house, view.timeline)]],
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
    const change = (inst, changes, message) => async () => {     // marked as paid: by the user
      try { show(await api("PUT", `/houses/${house.id}/installments/${inst.id}`, { ...inst, ...changes })); notify(message); }
      catch (error) { notify(error.message, true); }
    };
    const remove = async (inst, n) => {
      if (!confirm(`Excluir a prestação ${n} (${formatMoney(inst.amount_cents)}, vence ${formatDate(inst.due_date)})?`)) return;
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
        h("td", { className: "num" }, formatMoney(inst.amount_cents)), h("td", {}, state(inst)),
        h("td", {}, actionsMenu(`prestação ${n}`, [
          inst.paid_date ? { text: "Desmarcar pagamento", onclick: change(inst, { paid_date: "", paid_by: "" }, "Pagamento desmarcado.") }
            : { text: "Marcar como paga hoje", onclick: change(inst, { paid_date: now, paid_by: ctx.me }, "Prestação paga.") },
          { text: "Editar", onclick: () => installmentDialog(house, inst, n) },
          { text: "Excluir", danger: true, onclick: () => remove(inst, n) }])));
    });

    const firstOpen = installments.findIndex((inst) => !inst.paid_date);       // opens on the next one to pay
    const [body, pager] = pagedRows(rows, { start: Math.floor((firstOpen < 0 ? rows.length - 1 : firstOpen) / PAGE_SIZE) });

    const progress = h("span", { className: "bar-fill paid-fill" });
    progress.style.width = `${((100 * payment.paid_count) / payment.installments_count).toFixed(1)}%`;   // CSSOM: allowed by the CSP
    card.append(
      h("div", { className: "totals" },
        tile("Pagas", `${payment.paid_count} de ${payment.installments_count}`, formatMoney(payment.paid_cents)),
        tile("Falta pagar", formatMoney(payment.open_cents),
          payment.next_due_date ? `próxima: ${formatDate(payment.next_due_date)}` : "tudo pago"),
        tile("Pago da compra", formatMoney(payment.total_paid_cents), "entrada + prestações pagas")),
      h("span", { className: "bar", title: percent(payment.paid_count, payment.installments_count) }, progress),
      h("div", { className: "table-scroll" }, h("table", { className: "money", id: "installments-table" },
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
        h("thead", {}, h("tr", {}, ["Sócio", "Compra", "Prestações", "Reforma", "Total", ""].map((c, i) =>
          h("th", { className: i > 0 && i < 5 ? "num" : null }, c)))),
        // data-label: on a phone each partner is a block, the label next to each amount (style.css)
        h("tbody", {}, totals.by_member.map((r) => h("tr", {},
          h("td", {}, memberName(r.member_id)),
          h("td", { className: "num", "data-label": "Compra" }, formatMoney(r.purchase_cents)),
          h("td", { className: "num", "data-label": "Prestações" }, formatMoney(r.installments_cents)),
          h("td", { className: "num", "data-label": "Reforma" }, formatMoney(r.renovation_cents)),
          h("td", { className: "num" }, h("strong", {}, formatMoney(r.total_cents))),
          h("td", { className: "num muted" }, percent(r.total_cents, invested))))),
        h("tfoot", {}, h("tr", {}, h("td", {}, "Total pago"),
          ...[["purchase_cents", "Compra"], ["installments_cents", "Prestações"], ["renovation_cents", "Reforma"],
            ["total_cents", null]].map(([k, label]) =>
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

  function houseDialog(house, onSaved, defaults = {}) {
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
      value: house ? (house.target_profit_percent ? percentText(house.target_profit_percent) : "")
        : defaults.default_profit_percent ? percentText(defaults.default_profit_percent) : "" });

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

    // who bought it: only me, or with partners and how much each one paid at the purchase (only when registering:
    // the split is set here, in the act of buying, and can't be changed later)
    const buyersType = (value, text) => h("label", { className: "choice" },
      h("input", { type: "radio", name: "h-buyers", value, checked: value === "me", onchange: toggleBuyers }), text);
    const ownerShare = h("input", { id: "h-owner-share", inputMode: "decimal", placeholder: "0,00" });
    const partnerRows = h("div", { id: "h-partners" });
    const split = h("p", { className: "muted hint", id: "h-split" });
    const addPartner = () => {
      const row = h("div", { className: "partner-row" },
        h("input", { className: "p-phone", type: "tel", inputMode: "numeric", maxLength: 11, placeholder: "Celular",
          "aria-label": "Celular do sócio (DDD + número)" }),
        h("input", { className: "p-cents", inputMode: "decimal", placeholder: "Valor (R$)", "aria-label": "Quanto o sócio pagou (R$)" }),
        h("button", { type: "button", className: "link danger-link", "aria-label": "Tirar este sócio",
          onclick: () => { row.remove(); updateSplit(); } }, "✕"));
      row.querySelector(".p-cents").addEventListener("input", updateSplit);
      partnerRows.append(row);
      row.querySelector(".p-phone").focus();
    };
    const buyers = h("div", { className: "installments-fields buyers-fields" },
      field("h-owner-share", "Sua parte na compra (R$)", ownerShare),
      h("label", {}, "Sócios: celular e quanto cada um pagou na compra"), partnerRows,
      h("button", { type: "button", className: "secondary small", onclick: addPartner }, "+ Sócio"),
      split,
      h("p", { className: "muted hint" }, "Cada sócio recebe um convite no celular. A divisão da compra é definida só aqui, no cadastro."));
    const upfront = () => {          // what was paid at the purchase: the cash price or the entrada, plus the costs
      const paid = toCents((chosen() === "installments" ? down.value : price.value) || "0");
      const c = toCents(costs.value || "0");
      return paid === null || c === null ? null : paid + c;
    };
    function updateSplit() {         // "Pago na compra R$ 318.000,00 · divisão: faltam R$ 18.000,00"
      const total = upfront();
      const parts = [ownerShare, ...partnerRows.querySelectorAll(".p-cents")].map((i) => toCents(i.value || "0"));
      if (!total || parts.some((v) => v === null)) { split.textContent = ""; return; }     // nothing to split yet
      const sum = parts.reduce((a, b) => a + b, 0);
      split.textContent = `Pago na compra: ${formatMoney(total)} · `
        + (sum === total ? "a divisão fecha." : `${sum < total ? "faltam" : "passam"} ${formatMoney(Math.abs(total - sum))}.`);
    }
    function toggleBuyers() {
      const together = dialog.querySelector("input[name=h-buyers]:checked").value === "partners";
      buyers.hidden = !together;
      if (together && !partnerRows.children.length) addPartner();
      updateSplit();
    }
    if (!house) for (const input of [ownerShare, price, costs, down]) input.addEventListener("input", updateSplit);

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
      !house && [h("fieldset", { className: "choices" }, h("legend", {}, "Quem comprou"),
        buyersType("me", "Só eu"), buyersType("partners", "Com sócios")), buyers],
      areas,
      field("h-profit", "Lucro desejado (%)", profit),
      h("p", { className: "muted hint" }, "Sobre o total investido (compra + reforma): a página da casa mostra por quanto vender hoje."),
      field("h-notes", "Observações", notes),
      h("div", { className: "actions" }, save, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    toggle();
    if (!house) { buyers.hidden = true; for (const r of dialog.querySelectorAll("input[name=h-payment]")) r.addEventListener("change", updateSplit); }
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
        if (!house && dialog.querySelector("input[name=h-buyers]:checked").value === "partners") {
          body.owner_share_cents = cents(ownerShare, "Sua parte na compra", false);
          body.partners = [...partnerRows.children].map((row) => ({ phone: row.querySelector(".p-phone").value.trim(),
            cents: cents(row.querySelector(".p-cents"), "Quanto o sócio pagou", false) }));
          if (body.partners.length === 0) throw new Error("Sócios: adicione ao menos um, ou marque “Só eu”");
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
        const body = { date: date.value, category: category.value, description: description.value,
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
    const date = h("input", { id: "t-date", type: "date", value: entry?.date || today() });
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
        const body = { date: date.value, caption: caption.value, photos };
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
    const paidBy = paidBySelect("i-paid-by", inst.paid_date ? inst.paid_by || ctx.members[0].id : ctx.me);
    const save = h("button", { className: "primary" }, "Salvar");
    const dialog = openDialog(`Prestação ${n}`,
      h("div", { className: "two-columns" },
        h("div", {}, field("i-due", "Vencimento", due)), h("div", {}, field("i-value", "Valor (R$)", amount))),
      field("i-paid", "Paga em (vazio se ainda não foi paga)", paid),
      paidBy && field("i-paid-by", "Paga por", paidBy),
      h("div", { className: "actions" }, save, h("button", { className: "secondary", onclick: () => dialog.close() }, "Fechar")));
    save.addEventListener("click", () => whileDisabled(save, async () => {
      try {
        const body = { due_date: due.value, amount_cents: cents(amount, "Valor"), paid_date: paid.value,
          paid_by: paid.value && paidBy ? paidBy.value : "" };
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
