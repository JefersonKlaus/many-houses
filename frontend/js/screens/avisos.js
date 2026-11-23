// Avisos: everything that needs the user's attention, in one place: the invites to be a partner (accept or
// decline) and the bills and installments due in two days or less, or late. A due date opens its house,
// already on the tab where it is paid.
import { api } from "../api.js";
import { nav } from "../nav.js";
import { formatDate, formatMoney, formatPhone, h, notify, render, whileDisabled } from "../util.js";

export async function mount(container) {
  async function load() {
    let houses, invites;
    try { [houses, invites] = await Promise.all([api("GET", "/houses"), api("GET", "/invites")]); }
    catch (error) { return render(container, h("p", { className: "notice" }, error.message)); }
    nav.report({ houses, invites });
    const due = houses.flatMap((x) => x.due_soon || []).sort((a, b) => a.days - b.days);
    render(container, h("h1", {}, "Avisos"),
      invites.map(inviteCard), dueCard(due),
      invites.length === 0 && due.length === 0 && h("p", { className: "notice", id: "no-notices" }, "Nenhum aviso por enquanto."));
  }

  /** "(11) 98888-7777 convidou você para ser sócio da casa X": accept (it joins the list) or decline. */
  function inviteCard(invite) {
    const accept = h("button", { className: "primary small" }, "Aceitar");
    const decline = h("button", { className: "secondary small" }, "Recusar");
    accept.onclick = () => whileDisabled(accept, async () => {
      try {
        await api("POST", `/invites/${invite.id}/accept`, {});
        notify(`Agora você é sócio de "${invite.house_name}": ela já está na sua lista.`);
      } catch (error) { notify(error.message, true); }
      load();
    });
    decline.onclick = () => whileDisabled(decline, async () => {
      if (!confirm(`Recusar o convite para a casa "${invite.house_name}"?`)) return;
      try { await api("POST", `/invites/${invite.id}/decline`, {}); notify("Convite recusado."); }
      catch (error) { notify(error.message, true); }
      load();
    });
    return h("div", { className: "card invite", role: "status" },
      h("p", {}, h("strong", {}, invite.from_name || formatPhone(invite.from_phone) || "Alguém"),
        invite.from_name && invite.from_phone && h("span", { className: "muted" }, ` (${formatPhone(invite.from_phone)})`),
        " convidou você para ser sócio da casa ", h("strong", {}, `“${invite.house_name}”`), "."),
      h("p", { className: "muted" }, "Aceitando, a casa aparece na sua lista e vocês lançam juntos os pagamentos."),
      h("div", { className: "actions" }, accept, decline));
  }

  const when = (days) => days < 0 ? `venceu há ${-days} dia${days === -1 ? "" : "s"}` : days === 0 ? "vence hoje"
    : days === 1 ? "vence amanhã" : `vence em ${days} dias`;

  /** "Casa ABC: a conta de Energia vence em 2 dias": each one opens its house on the tab where it is paid. */
  function dueCard(items) {
    if (items.length === 0) return null;
    return h("div", { className: "card due-card", id: "due-soon", role: "status" }, h("h2", {}, "Contas a vencer"),
      h("ul", {}, items.map((d) => h("li", { className: d.days < 0 ? "late" : null },
        h("button", { className: "link", onclick: () => nav.go("Casas", { house: d.house_id, tab: d.type === "installment" ? "purchase" : "recurring" }) },
          d.house_name),
        ` tem ${d.type === "installment" ? "uma prestação" : `a conta de ${d.name}`} que ${when(d.days)} (${formatDate(d.due_date)})`,
        d.type === "installment" && ` · ${formatMoney(d.amount_cents)}`))));
  }

  load();
}
