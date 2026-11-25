// Avisos: everything that needs the user's attention, in one place: the invites to be a partner (accept or
// decline) and the bills and installments due in two days or less, or late. A due date opens its house,
// already on the tab where it is paid.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Go } from "../App";
import { errorText, formatDate, formatMoney, formatPhone } from "../format";
import { useNotices } from "../notices";
import { notify } from "../toast";
import type { DueItem, HouseSummary, PendingInvite } from "../types";
import { EmptyState, useBusy } from "../ui";

const when = (days: number) => days < 0 ? `venceu há ${-days} dia${days === -1 ? "" : "s"}` : days === 0 ? "vence hoje"
  : days === 1 ? "vence amanhã" : `vence em ${days} dias`;

export function Avisos({ go }: { go: Go }) {
  const { report } = useNotices();
  const [data, setData] = useState<{ due: DueItem[]; invites: PendingInvite[] } | null>(null);
  const [failed, setFailed] = useState("");
  const load = useCallback(async () => {
    try {
      const [houses, invites] = await Promise.all([api<HouseSummary[]>("GET", "/houses"), api<PendingInvite[]>("GET", "/invites")]);
      report({ houses, invites });
      setData({ due: houses.flatMap((x) => x.due_soon || []).sort((a, b) => a.days - b.days), invites });
    } catch (error) { setFailed(errorText(error)); }
  }, [report]);
  useEffect(() => { load(); }, [load]);

  if (failed) return <p className="notice">{failed}</p>;
  if (!data) return <p className="notice">Carregando…</p>;
  return (
    <>
      <h1>Avisos</h1>
      {data.invites.map((invite) => <InviteCard key={invite.id} invite={invite} onDone={load} />)}
      {data.due.length > 0 && (
        <div className="card due-card" id="due-soon" role="status">
          <h2>Contas a vencer</h2>
          <ul>
            {data.due.map((d, i) => (
              <li key={i} className={d.days < 0 ? "late" : undefined}>
                <button className="link" onClick={() => go("Casas", { house: d.house_id, tab: d.type === "installment" ? "purchase" : "recurring" })}>
                  {d.house_name}
                </button>
                {` tem ${d.type === "installment" ? "uma prestação" : `a conta de ${d.name}`} que ${when(d.days)} (${formatDate(d.due_date)})`}
                {d.type === "installment" && ` · ${formatMoney(d.amount_cents)}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.invites.length === 0 && data.due.length === 0 && <EmptyState art="bell" id="no-notices" title="Nenhum aviso por enquanto"><p className="muted">Convites de sócios e contas a vencer aparecem aqui.</p></EmptyState>}
    </>
  );
}

/** "(11) 98888-7777 convidou você para ser sócio da casa X": accept (it joins the list) or decline. */
function InviteCard({ invite, onDone }: { invite: PendingInvite; onDone: () => void }) {
  const [busy, run] = useBusy();
  const accept = () => run(async () => {
    try {
      await api("POST", `/invites/${invite.id}/accept`, {});
      notify(`Agora você é sócio de "${invite.house_name}": ela já está na sua lista.`);
    } catch (error) { notify(errorText(error), true); }
    onDone();
  });
  const decline = () => run(async () => {
    if (!confirm(`Recusar o convite para a casa "${invite.house_name}"?`)) return;
    try { await api("POST", `/invites/${invite.id}/decline`, {}); notify("Convite recusado."); }
    catch (error) { notify(errorText(error), true); }
    onDone();
  });
  return (
    <div className="card invite" role="status">
      <p>
        <strong>{invite.from_name || formatPhone(invite.from_phone) || "Alguém"}</strong>
        {invite.from_name && invite.from_phone && <span className="muted">{` (${formatPhone(invite.from_phone)})`}</span>}
        {" convidou você para ser sócio da casa "}<strong>{`“${invite.house_name}”`}</strong>.
      </p>
      <p className="muted">Aceitando, a casa aparece na sua lista e vocês lançam juntos os pagamentos.</p>
      <div className="actions">
        <button className="primary small" disabled={busy} onClick={accept}>Aceitar</button>
        <button className="secondary small" disabled={busy} onClick={decline}>Recusar</button>
      </div>
    </div>
  );
}
