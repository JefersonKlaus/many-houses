// One house's page: what it cost, for how much to sell it, and the tabs: the purchase with its installments, the
// recurring bills (a month at a time, like accounts payable), the renovation by area and category with its costs,
// the timeline of photos and the partners with how much each one put in.
import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { api } from "../../api";
import { errorText, formatDate, formatMoney, formatPhone, monthName, percent, percentText, shiftMonth, today } from "../../format";
import { notify } from "../../toast";
import type { Expense, HouseView, Installment, Payment, RecurringBill, Totals } from "../../types";
import { ActionsMenu, PAGE_SIZE, Pager, Tile, useBusy, usePage } from "../../ui";
import { Badge, CATEGORIES, useHouse } from "./context";
import { bundleText, EndDialog, ExpenseDialog, InstallmentDialog, PaymentDialog, PlanDialog, saveBills, ScheduleDialog,
  TimelineDialog } from "./dialogs";

export interface PageMemory {
  tab: Record<string, string>;      // the tab open on each house: it stays open when the page is redrawn
  month: Record<string, string>;    // the month on screen in Despesas recorrentes ("" = this month)
}

/** Runs a change that answers the page, and draws it. */
function useChange() {
  const { show } = useHouse();
  return async (send: () => Promise<HouseView>, message: string) => {
    try { show(await send()); notify(message); } catch (error) { notify(errorText(error), true); }
  };
}

export function HousePage({ memory, onBack, onEdit, onDeleted }:
  { memory: PageMemory; onBack: () => void; onEdit: () => void; onDeleted: () => void }) {
  const { view } = useHouse();
  const { house, expenses, installments, totals } = view;
  const remove = async () => {
    const what = [`${expenses.length} custo(s)`, installments.length > 0 && `${installments.length} prestação(ões)`].filter(Boolean).join(" e ");
    if (!confirm(`Excluir "${house.name}" com ${what}? Isso não pode ser desfeito.`)) return;
    try { await api("DELETE", `/houses/${house.id}`); notify("Casa excluída."); onDeleted(); }
    catch (error) { notify(errorText(error), true); }
  };
  const financed = house.payment_type === "installments";
  const recurring = expenses.filter((e) => e.category === "recurring");
  const tabs: [string, ReactNode, () => ReactNode][] = [
    ["purchase", financed ? `Compra (${totals.payment.paid_count}/${totals.payment.installments_count})` : "Compra",
      () => <><PurchaseCard />{financed && <InstallmentsCard />}</>],
    // "Despesas recorrentes" where there is room, just "Recorrentes" on a small screen (style.css)
    ["recurring", <><span className="tab-long">Despesas recorrentes</span><span className="tab-short">Recorrentes</span>
      {totals.recurring_count ? ` (${totals.recurring_count})` : ""}</>,
    () => <RecurringCard payments={recurring} memory={memory} />],
    ["renovation", "Reforma", () => <><AreasCard /><CategoriesCard /><ExpensesCard expenses={expenses.filter((e) => e.category !== "recurring")} /></>],
    ["timeline", view.timeline.length ? `Timeline (${view.timeline.length})` : "Timeline", () => <TimelineCard />],
    ["partners", view.members.length > 1 ? `Sócios (${view.members.length})` : "Sócios", () => <><PartnersCard /><InvestmentCard /></>],
  ];
  return (
    <>
      <button className="link back" onClick={onBack}>‹ Casas</button>
      <div className="row">
        <div><h1>{house.name}<Badge status={house.status} /></h1><p className="muted address">{house.address}</p></div>
        <div className="actions tight">
          <button className="secondary" onClick={onEdit}>Editar casa</button>
          <button className="danger" onClick={remove}>Excluir</button>
        </div>
      </div>
      <div className="totals" id="house-totals">
        <Tile label="Compra" value={formatMoney(totals.purchase_cents)} />
        <Tile label="Reforma" value={formatMoney(totals.renovation_cents)} note={`${totals.expense_count} custo(s)`} />
        <Tile label="Total investido" value={formatMoney(totals.total_cents)} />
      </div>
      <SaleCard totals={totals} />
      <Tabs houseId={house.id} memory={memory} list={tabs} />
    </>
  );
}

/** Tabs: [[key, label, () => panel]...]. Arrow keys move between them; the open one is kept in `memory`. */
function Tabs({ houseId, memory, list }: { houseId: string; memory: PageMemory; list: [string, ReactNode, () => ReactNode][] }) {
  const stored = memory.tab[houseId];
  const [open, setOpen] = useState(list.some(([k]) => k === stored) ? stored : list[0][0]);
  const select = (key: string, focus = false) => {
    memory.tab[houseId] = key;
    setOpen(key);
    if (focus) setTimeout(() => document.getElementById(`tab-${key}`)?.focus());
  };
  const onKey = (e: KeyboardEvent, key: string) => {
    const step = ({ ArrowRight: 1, ArrowLeft: -1 } as Record<string, number>)[e.key];
    if (!step) return;
    const i = list.findIndex(([k]) => k === key);
    select(list[(i + step + list.length) % list.length][0], true);
  };
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Seções da casa">
        {list.map(([key, label]) => (
          <button key={key} type="button" role="tab" id={`tab-${key}`} aria-controls={`panel-${key}`}
            aria-selected={key === open} tabIndex={key === open ? 0 : -1}
            onClick={() => select(key)} onKeyDown={(e) => onKey(e, key)}>{label}</button>
        ))}
      </div>
      {list.map(([key, , content]) => (
        <div key={key} role="tabpanel" id={`panel-${key}`} aria-labelledby={`tab-${key}`} hidden={key !== open}>
          {key === open && content()}
        </div>
      ))}
    </>
  );
}

/** For how much to sell today, as it is, to make the profit wanted. */
function SaleCard({ totals }: { totals: Totals }) {
  const { sale } = totals;
  if (!(sale.target_profit_percent > 0)) {
    return <div className="card sale" id="sale"><p className="muted">Informe o lucro desejado (%) em “Editar casa” e o sistema mostra por quanto vender a casa hoje.</p></div>;
  }
  return (
    <div className="card sale" id="sale">
      <span className="sale-label">{`Para lucrar ${percentText(sale.target_profit_percent)} %, venda hoje por`}</span>
      <strong className="sale-price">{formatMoney(sale.suggested_price_cents)}</strong>
      <p className="muted">{`Total investido ${formatMoney(totals.total_cents)} + lucro de ${formatMoney(sale.target_profit_cents)}. O valor sobe a cada custo de reforma lançado.`}</p>
    </div>
  );
}

// ------------------------------------------------------------------ purchase
function PurchaseCard() {
  const { view } = useHouse();
  const { house, bundle } = view;
  const payment = view.totals.payment;
  const financed = house.payment_type === "installments";
  return (
    <div className="card" id="purchase">
      <h2>Compra</h2>
      <dl className="details">
        <dt>Data</dt><dd>{formatDate(house.purchase_date)}</dd>
        <dt>Pagamento</dt><dd>{financed ? "Parcelado" : "À vista"}</dd>
        {bundle.length > 1 && <><dt>Compra conjunta</dt><dd>{bundleText(bundle)}
          <span className="muted"> (a entrada e as prestações são divididas nessa proporção, pelo valor de cada imóvel)</span></dd></>}
        <dt>Valor do imóvel</dt><dd>{formatMoney(house.purchase_price_cents)}</dd>
        {financed && <>
          <dt>Entrada</dt><dd>{formatMoney(payment.down_payment_cents)}</dd>
          <dt>Restante</dt><dd>{formatMoney(house.purchase_price_cents - payment.down_payment_cents)}<span className="muted"> (pago em prestações)</span></dd>
        </>}
        <dt>Custos da compra</dt><dd>{formatMoney(house.purchase_costs_cents)}<span className="muted"> (ITBI, escritura, registro, corretagem…)</span></dd>
        <dt>Total</dt><dd><strong>{formatMoney(house.purchase_price_cents + house.purchase_costs_cents)}</strong></dd>
      </dl>
      {house.notes && <p className="notes">{house.notes}</p>}
    </div>
  );
}

/** The prestações: how much is paid, what is left, each one with its state; a long plan a page at a time,
 *  opening on the page of the next one to pay. */
function InstallmentsCard() {
  const { view, openDialog, memberName, shared } = useHouse();
  const { house, installments, bundle } = view;
  const payment: Payment = view.totals.payment;
  const grouped = bundle.length > 1;
  const change = useChange();
  const firstOpen = installments.findIndex((i) => !i.paid_date);
  const [page, setPage] = usePage(installments.length, Math.floor((firstOpen < 0 ? installments.length - 1 : firstOpen) / PAGE_SIZE));
  const add = <button className="primary small" onClick={() => openDialog(<PlanDialog house={house} bundle={bundle} />)}>Adicionar prestações</button>;
  if (installments.length === 0) {
    return <div className="card" id="installments"><div className="row"><h2>Prestações</h2>{add}</div>
      <p className="muted">Nenhuma prestação. Adicione as prestações para marcar cada uma quando for paga.</p></div>;
  }
  const now = today();
  const put = (inst: Installment, changes: Partial<Installment>, message: string) => change(() =>
    api<HouseView>("PUT", `/houses/${house.id}/installments/${inst.id}`, { ...inst, ...changes }), message);
  const remove = (inst: Installment, n: string) => {
    if (!confirm(grouped && inst.group_id
      ? `Excluir a prestação ${n} (${formatMoney(inst.total_cents)}, vence ${formatDate(inst.due_date)}) de todas as casas desta compra?`
      : `Excluir a prestação ${n} (${formatMoney(inst.amount_cents)}, vence ${formatDate(inst.due_date)})?`)) return;
    change(() => api<HouseView>("DELETE", `/houses/${house.id}/installments/${inst.id}`), "Prestação excluída.");
  };
  const state = (inst: Installment) => inst.paid_date
    ? <><span className="badge paid">Paga</span><small className="muted paid-on">{formatDate(inst.paid_date)}</small>
      {shared && <small className="muted paid-on">{memberName(inst.paid_by)}</small>}</>
    : inst.due_date < now ? <span className="badge overdue">Atrasada</span> : <span className="badge open">Em aberto</span>;
  const heads = ["Nº", "Vencimento", ...(grouped ? ["Parcela total"] : []), grouped ? "Desta casa" : "Valor", "Situação", ""];
  return (
    <div className="card" id="installments">
      <div className="row"><h2>Prestações</h2>{add}</div>
      {grouped && <p className="muted hint" id="bundle-note">{`Compra conjunta: cada parcela é paga uma vez só, pelas ${bundle.length} casas (${bundleText(bundle)}). `
        + "Marcar como paga, mudar o vencimento ou excluir vale para todas."}</p>}
      <div className="totals">
        <Tile label="Pagas" value={`${payment.paid_count} de ${payment.installments_count}`} note={formatMoney(payment.paid_cents)} />
        <Tile label="Falta pagar" value={formatMoney(payment.open_cents)}
          note={payment.next_due_date ? `próxima: ${formatDate(payment.next_due_date)}` : "tudo pago"} />
        <Tile label="Pago da compra" value={formatMoney(payment.total_paid_cents)} note="entrada + prestações pagas" />
      </div>
      <span className="bar" title={percent(payment.paid_count, payment.installments_count)}>
        <span className="bar-fill paid-fill" style={{ width: `${((100 * payment.paid_count) / payment.installments_count).toFixed(1)}%` }} />
      </span>
      <div className="table-scroll">
        <table className="money" id="installments-table">
          <thead><tr>{heads.map((c, i) => <th key={i} className={["Valor", "Parcela total", "Desta casa"].includes(c) ? "num" : undefined}>{c}</th>)}</tr></thead>
          <tbody>
            {installments.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((inst, k) => {
              const index = page * PAGE_SIZE + k;
              const n = `${index + 1}/${installments.length}`;
              return (
                <tr key={inst.id} className={inst.paid_date ? "paid" : undefined}>
                  <td title={n}>{index + 1}</td>
                  <td>{formatDate(inst.due_date)}</td>
                  {grouped && <td className="num">{inst.group_id ? formatMoney(inst.total_cents) : "–"}</td>}
                  <td className="num">{formatMoney(inst.amount_cents)}
                    {grouped && inst.group_id && inst.total_cents > 0 && <small className="muted">{` ${percent(inst.amount_cents, inst.total_cents)}`}</small>}</td>
                  <td>{state(inst)}</td>
                  <td><ActionsMenu label={`prestação ${n}`} items={[
                    inst.paid_date ? { text: "Desmarcar pagamento", onClick: () => put(inst, { paid_date: "", paid_by: "" }, "Pagamento desmarcado.") }
                      : { text: "Marcar como paga hoje", onClick: () => put(inst, { paid_date: now, paid_by: view.me }, "Prestação paga.") },
                    { text: "Editar", onClick: () => openDialog(<InstallmentDialog inst={inst} n={n} grouped={grouped} />) },
                    { text: "Excluir", danger: true, onClick: () => remove(inst, n) }]} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager page={page} count={installments.length} onPage={setPage} />
    </div>
  );
}

// ------------------------------------------------------------------ recurring bills
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const refOf = (payment: Expense) => payment.reference || payment.date.slice(0, 7);

function BillState({ due, paid }: { due: string; paid: boolean }) {
  if (paid) return <span className="badge paid">Paga</span>;
  const days = Math.round((Date.parse(due) - Date.parse(today())) / 86400000);
  if (days < 0) return <span className="badge overdue">{`Atrasada ${-days} dia${days === -1 ? "" : "s"}`}</span>;
  if (days <= 2) return <span className="badge soon">{days === 0 ? "Vence hoje" : days === 1 ? "Vence amanhã" : "Vence em 2 dias"}</span>;
  return <span className="badge open">Em aberto</span>;
}

/** Like an accounts-payable screen: a month at a time, one line per bill with its state and a Pagar button. The
 *  bills (name + due day) are registered once; a payment refers to a month (its `reference`). */
function RecurringCard({ payments, memory }: { payments: Expense[]; memory: PageMemory }) {
  const { view, openDialog, memberName, shared } = useHouse();
  const house = view.house;
  const change = useChange();
  const [month, setMonthState] = useState(memory.month[house.id] || today().slice(0, 7));
  const setMonth = (m: string) => { memory.month[house.id] = m; setMonthState(m); };
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const save = (list: RecurringBill[], message: string) => change(() => saveBills(house.id, list), message);
  const removePayment = (p: Expense) => {
    if (!confirm(`Excluir o pagamento "${p.description}" (${formatMoney(p.amount_cents)})?`)) return;
    change(() => api<HouseView>("DELETE", `/houses/${house.id}/expenses/${p.id}`), "Pagamento excluído.");
  };
  const inMonth = payments.filter((p) => refOf(p) === month);
  const used = new Set<string>();
  // a bill shows in the months it is due: from the one it was registered in to the one it was cancelled in
  const active = house.recurring_bills.filter((b) => (!b.since || month >= b.since) && (!b.until || month <= b.until));
  const lines = [...active].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name)).map((bill) => {
    const payment = inMonth.find((p) => !used.has(p.id) && sameName(p.description, bill.name));
    if (payment) used.add(payment.id);
    return { bill: bill as RecurringBill | null, payment, due: `${month}-${String(Math.min(bill.day, lastDay)).padStart(2, "0")}` };
  });
  const loose = inMonth.filter((p) => !used.has(p.id)).map((payment) => ({ bill: null, payment, due: "" }));
  const rows = [...lines, ...loose];
  const paidCents = inMonth.reduce((sum, p) => sum + p.amount_cents, 0);
  const paidCount = lines.filter((l) => l.payment).length;
  return (
    <div className="card" id="recurring">
      <div className="row">
        <h2>Contas recorrentes</h2>
        <div className="actions tight">
          <button className="secondary small" id="new-recurring" onClick={() => openDialog(<PaymentDialog payment={null} preset={null} month={month} />)}>Lançar pagamento</button>
          <button className="primary small" id="new-schedule" onClick={() => openDialog(<ScheduleDialog bill={null} />)}>Cadastrar conta</button>
        </div>
      </div>
      <div className="month-nav">
        <button className="secondary small" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <strong id="recurring-month">{monthName(month)}</strong>
        <button className="secondary small" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        {month !== today().slice(0, 7) && <button className="link" onClick={() => setMonth(today().slice(0, 7))}>Hoje</button>}
      </div>
      {rows.length === 0
        ? <p className="muted" id="recurring-empty">{house.recurring_bills.length === 0
          ? "Cadastre as contas que vencem todo mês (energia, água, internet…) com o dia do vencimento. Dois dias antes o sistema avisa em Avisos."
          : "Nada lançado neste mês."}</p>
        : <>
          <div className="totals">
            <Tile label="Pagas" value={`${paidCount} de ${lines.length}`} note="contas do mês" />
            <Tile label="Total pago" value={formatMoney(paidCents)} note={monthName(month)} />
          </div>
          <ul className="list" id="recurring-bills">
            {rows.map(({ bill, payment, due }) => {
              const name = bill ? bill.name : payment!.description;
              const detail = [due ? `vence dia ${due.slice(8)}` : "avulsa", bill?.until && `encerra em ${monthName(bill.until)}`,
                payment && `paga em ${formatDate(payment.date)}`, payment && shared && `por ${memberName(payment.paid_by)}`]
                .filter(Boolean).join(" · ");
              return (
                <li key={bill?.id || payment!.id} className="list-item bill">
                  <div className="list-main"><strong>{name}</strong><div className="muted">{detail}</div></div>
                  <div className="bill-side">
                    {payment && <strong className="bill-amount">{formatMoney(payment.amount_cents)}</strong>}
                    <BillState due={due} paid={Boolean(payment)} />
                    {!payment && <button className="primary small" onClick={() => openDialog(<PaymentDialog payment={null} preset={{ name, due }} month={month} />)}>Pagar</button>}
                    <ActionsMenu label={name} items={[
                      payment && { text: "Editar pagamento", onClick: () => openDialog(<PaymentDialog payment={payment} preset={null} month={month} />) },
                      payment && { text: "Excluir pagamento", danger: true, onClick: () => removePayment(payment) },
                      bill && (bill.until
                        ? { text: "Reativar conta", onClick: () => save(house.recurring_bills.map((x) => (x.id === bill.id ? { ...x, until: "" } : x)), "Conta reativada.") }
                        : { text: "Encerrar conta", onClick: () => openDialog(<EndDialog bill={bill} month={month} />) }),
                      bill && { text: "Editar conta", onClick: () => openDialog(<ScheduleDialog bill={bill} />) },
                      bill && { text: "Excluir conta", danger: true, onClick: () => {
                        if (confirm(`Excluir a conta "${bill.name}"? Os pagamentos já registrados ficam.`)) {
                          save(house.recurring_bills.filter((x) => x.id !== bill.id), "Conta excluída.");
                        }
                      } }]} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>}
    </div>
  );
}

// ------------------------------------------------------------------ renovation
function Bars({ rows, whole }: { rows: { key: string; label: ReactNode; cents: number; className: string }[]; whole: number }) {
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="bar-label">{r.label}</span>
          <span className="bar"><span className={`bar-fill ${r.className}`} style={{ width: `${((100 * r.cents) / whole).toFixed(1)}%` }} /></span>
          <span className="bar-value">{formatMoney(r.cents)}<small className="muted">{` ${percent(r.cents, whole)}`}</small></span>
        </li>
      ))}
    </ul>
  );
}

/** Which part of the house costs the most: one bar per area, the most expensive first. */
function AreasCard() {
  const { view } = useHouse();
  const { house, totals } = view;
  if (house.areas.length === 0) {
    return <div className="card" id="areas"><h2>Reforma por área</h2>
      <p className="muted">Marque em “Editar casa” as áreas que precisam de reforma (cozinha, telhado…) e vincule cada custo a uma delas.</p></div>;
  }
  const rows: { id: string; name: string; cents: number; none?: boolean }[] = totals.by_area.filter((a) => a.cents > 0).sort((a, b) => b.cents - a.cents);
  if (totals.no_area_cents > 0) rows.push({ id: "", name: "Sem área", cents: totals.no_area_cents, none: true });
  const waiting = totals.by_area.filter((a) => a.cents === 0).map((a) => a.name);
  return (
    <div className="card" id="areas">
      <h2>Reforma por área</h2>
      {rows.length === 0 ? <p className="muted">Nenhum custo lançado ainda.</p>
        : <Bars whole={totals.renovation_cents} rows={rows.map((a, index) => ({ key: a.id || "none", cents: a.cents,
          className: a.none ? "area-none" : index === 0 ? "area-top" : "area",
          label: <>{a.name}{index === 0 && !a.none && rows.length > 1 && <small className="top-tag"> mais cara</small>}</> }))} />}
      {waiting.length > 0 && <p className="muted">{`Ainda sem custos: ${waiting.join(", ")}.`}</p>}
    </div>
  );
}

function CategoriesCard() {
  const { totals } = useHouse().view;
  const used = Object.keys(CATEGORIES).filter((c) => totals.by_category[c] > 0);
  return (
    <div className="card">
      <h2>Reforma por categoria</h2>
      {used.length === 0 ? <p className="muted">Nenhum custo de reforma lançado ainda.</p>
        : <Bars whole={totals.renovation_cents} rows={used.map((c) => ({ key: c, label: CATEGORIES[c], cents: totals.by_category[c], className: `cat-${c}` }))} />}
    </div>
  );
}

function ExpensesCard({ expenses }: { expenses: Expense[] }) {
  const { view, openDialog, memberName, shared, viewPhoto } = useHouse();
  const { house, totals } = view;
  const change = useChange();
  const [page, setPage] = usePage(expenses.length);
  const areaName = (id: string) => house.areas.find((a) => a.id === id)?.name || "";
  const remove = (e: Expense) => {
    if (!confirm(`Excluir o custo "${e.description}" (${formatMoney(e.amount_cents)})?`)) return;
    change(() => api<HouseView>("DELETE", `/houses/${house.id}/expenses/${e.id}`), "Custo excluído.");
  };
  return (
    <div className="card">
      <div className="row"><h2>Custos da reforma</h2>
        <button className="primary small" onClick={() => openDialog(<ExpenseDialog expense={null} />)}>Novo custo</button></div>
      {expenses.length === 0 ? <p className="muted">Lance aqui cada compra de material, mão de obra ou serviço.</p> : <>
        <div className="table-scroll">
          <table className="money" id="expenses">
            <thead><tr>{["Data", "Descrição", "Categoria", "Valor", ""].map((c) => <th key={c} className={c === "Valor" ? "num" : undefined}>{c}</th>)}</tr></thead>
            <tbody>
              {expenses.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.date)}</td>
                  <td>{e.description}
                    {e.supplier && <div className="muted">{e.supplier}</div>}
                    {shared && <div className="muted paid-by">{`pago por ${memberName(e.paid_by)}`}</div>}
                    {(e.nf_photo_url || e.material_photo_url) && <div className="photo-links">
                      {e.nf_photo_url && <button className="link" onClick={() => viewPhoto(e.nf_photo_url, `NF: ${e.description}`)}>Ver NF</button>}
                      {e.material_photo_url && <button className="link" onClick={() => viewPhoto(e.material_photo_url, e.description)}>Ver foto</button>}
                    </div>}</td>
                  <td>{CATEGORIES[e.category] || e.category}{e.area_id && <div className="muted">{areaName(e.area_id)}</div>}</td>
                  <td className="num">{formatMoney(e.amount_cents)}</td>
                  <td><ActionsMenu label={e.description} items={[
                    { text: "Editar", onClick: () => openDialog(<ExpenseDialog expense={e} />) },
                    { text: "Excluir", danger: true, onClick: () => remove(e) }]} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>{`Total da reforma (${expenses.length})`}</td>
              <td className="num">{formatMoney(totals.renovation_cents)}</td><td /></tr></tfoot>
          </table>
        </div>
        <Pager page={page} count={expenses.length} onPage={setPage} />
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ timeline
/** The house's story in photos, oldest first, a page of 10 moments at a time, opening on the latest page. */
function TimelineCard() {
  const { view, openDialog, viewPhoto } = useHouse();
  const { house, timeline } = view;
  const change = useChange();
  const [page, setPage] = usePage(timeline.length, Math.ceil(timeline.length / PAGE_SIZE) - 1);
  const add = <button className="primary small" onClick={() => openDialog(<TimelineDialog entry={null} />)}>Adicionar fotos</button>;
  if (timeline.length === 0) {
    return <div className="card" id="timeline"><div className="row"><h2>Timeline</h2>{add}</div>
      <p className="muted">Registre aqui a evolução da casa, desde a compra até a conclusão: a data, o que mudou e as fotos.</p></div>;
  }
  return (
    <div className="card" id="timeline">
      <div className="row"><h2>Timeline</h2>{add}</div>
      <div>
        {timeline.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((entry) => (
          <article key={entry.id} className="moment">
            <div className="moment-head">
              <div><strong>{formatDate(entry.date)}</strong>{entry.caption && <p>{entry.caption}</p>}</div>
              <ActionsMenu label={`registro de ${formatDate(entry.date)}`} items={[
                { text: "Editar", onClick: () => openDialog(<TimelineDialog entry={entry} />) },
                { text: "Excluir", danger: true, onClick: () => {
                  if (confirm(`Excluir o registro de ${formatDate(entry.date)} e suas ${entry.photos.length} foto(s)?`)) {
                    change(() => api<HouseView>("DELETE", `/houses/${house.id}/timeline/${entry.id}`), "Registro excluído.");
                  }
                } }]} />
            </div>
            <div className="thumbs">
              {entry.photo_urls.map((url, i) => (
                <img key={url} className="photo-thumb" src={url} alt={`${entry.caption || formatDate(entry.date)} (${i + 1})`} loading="lazy"
                  onClick={() => viewPhoto(url, `${formatDate(entry.date)}${entry.caption ? ` · ${entry.caption}` : ""}`)} />
              ))}
            </div>
          </article>
        ))}
      </div>
      <Pager page={page} count={timeline.length} onPage={setPage} />
    </div>
  );
}

// ------------------------------------------------------------------ partners
/** Who the partners are (and the invites waiting), and the form to invite one by phone. Partners are all equal:
 *  any of them invites, cancels an invite and removes another partner (except whoever registered the house). */
function PartnersCard() {
  const { view, memberName, shared, show } = useHouse();
  const { house } = view;
  const change = useChange();
  const [phone, setPhone] = useState("");
  const [busy, run] = useBusy();
  const invite = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      try {
        show(await api<HouseView>("POST", `/houses/${house.id}/invites`, { phone: phone.trim() }));
        notify("Convite enviado. Ele aparece para a pessoa quando ela entrar no sistema.");
      } catch (error) { notify(errorText(error), true); }
    });
  };
  return (
    <div className="card" id="partners">
      <h2>Sócios</h2>
      {!shared ? <p className="muted">Nenhum sócio. Quem entrar como sócio depois da compra não tem parte nela: o que ele pagar entra pelas prestações e pela reforma.</p>
        : <ul className="members">
          {view.members.map((m) => (
            <li key={m.id} className={m.role === "invited" ? "pending" : undefined}>
              <div>
                <strong>{m.id === view.me ? `${m.name || "Você"} (você)` : m.name || formatPhone(m.phone)}</strong>
                <div className="muted">{[m.name && formatPhone(m.phone), m.role === "invited"
                  && `convidado em ${formatDate(house.invites.find((i) => i.id === m.id)?.date || "")}, aguardando resposta`].filter(Boolean).join(" · ")}</div>
              </div>
              {m.role === "partner" && m.id !== view.me && <button className="link danger-link" onClick={() => {
                if (confirm(`Remover ${memberName(m.id)} dos sócios desta casa?`)) {
                  change(() => api<HouseView>("DELETE", `/houses/${house.id}/partners/${m.id}`), "Sócio removido.");
                }
              }}>Remover</button>}
              {m.role === "invited" && <button className="link danger-link" onClick={() =>
                change(() => api<HouseView>("DELETE", `/houses/${house.id}/invites/${m.id}`), "Convite cancelado.")}>Cancelar convite</button>}
            </li>
          ))}
        </ul>}
      <form className="invite-form" onSubmit={invite}>
        <label htmlFor="p-phone">Convidar sócio (celular: DDD + número)</label>
        <div className="inline-add">
          <input id="p-phone" type="tel" inputMode="numeric" maxLength={11} placeholder="11987654321" autoComplete="off"
            value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className="primary small" type="submit" disabled={busy}>Convidar</button>
        </div>
      </form>
    </div>
  );
}

/** How much each partner put in so far. Only for a house with partners. */
function InvestmentCard() {
  const { view, memberName, shared } = useHouse();
  if (!shared) return null;
  const { totals } = view;
  const invested = totals.by_member.reduce((sum, r) => sum + r.total_cents, 0);
  const columns: [keyof typeof totals.by_member[number], string | null][] = [["purchase_cents", "Compra"], ["installments_cents", "Prestações"],
    ["renovation_cents", "Reforma"], ["recurring_cents", "Recorrentes"], ["total_cents", null]];
  return (
    <div className="card" id="investment">
      <h2>Investimento por sócio</h2>
      <div className="table-scroll">
        <table className="money" id="by-member">
          <thead><tr>{["Sócio", "Compra", "Prestações", "Reforma", "Recorrentes", "Total", ""].map((c, i) =>
            <th key={i} className={i > 0 && i < 6 ? "num" : undefined}>{c}</th>)}</tr></thead>
          <tbody>
            {totals.by_member.map((r) => (
              <tr key={r.member_id}>
                <td>{memberName(r.member_id)}</td>
                <td className="num" data-label="Compra">{formatMoney(r.purchase_cents)}</td>
                <td className="num" data-label="Prestações">{formatMoney(r.installments_cents)}</td>
                <td className="num" data-label="Reforma">{formatMoney(r.renovation_cents)}</td>
                <td className="num" data-label="Recorrentes">{formatMoney(r.recurring_cents)}</td>
                <td className="num"><strong>{formatMoney(r.total_cents)}</strong></td>
                <td className="num muted">{percent(r.total_cents, invested)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td>Total pago</td>
            {columns.map(([k, label]) => <td key={k} className="num" data-label={label ?? undefined}>
              {formatMoney(totals.by_member.reduce((sum, r) => sum + (r[k] as number), 0))}</td>)}
            <td /></tr></tfoot>
        </table>
      </div>
      <p className="muted hint">Compra: o que cada um pagou no ato da compra, definido no cadastro da casa. Prestações e reforma: o que cada um pagou, conforme o “pago por” de cada lançamento.</p>
    </div>
  );
}

