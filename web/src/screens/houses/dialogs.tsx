// The dialogs of a house's page: a renovation cost, a recurring bill and its payment, the installments and a
// moment of the timeline. Each one saves with one request and draws the page the API answers.
import { useEffect, useState } from "react";
import { api, uploadPhoto } from "../../api";
import { centsToText, dateValue, errorText, formatDate, monthName, money, percentText, today } from "../../format";
import { notify } from "../../toast";
import type { BundleHouse, Expense, House, HouseView, Installment, RecurringBill, TimelineEntry } from "../../types";
import { Autocomplete, DateInput, Dialog, Field, Select, useBusy, type PhotoChoice, PhotoField } from "../../ui";
import { CATEGORIES, useHouse } from "./context";

const refOf = (payment: Expense) => payment.reference || payment.date.slice(0, 7);

/** "Casa Azul 66,67 % · Casa Verde 33,33 %": the houses bought in the same deal and each one's share. */
export const bundleText = (bundle: BundleHouse[]) => bundle.map((b) => `${b.name} ${percentText(b.percent)} %`).join(" · ");

/** Saves with the button disabled, draws the page answered and closes; an error stays in the dialog. */
function useSave() {
  const { show, closeDialog } = useHouse();
  const [busy, run] = useBusy();
  const save = (send: () => Promise<HouseView>, message: string) => run(async () => {
    try {
      const view = await send();
      notify(message);
      closeDialog();
      show(view);
    } catch (error) { notify(errorText(error), true); }
  });
  return { busy, save, close: closeDialog };
}

function Actions({ busy, label = "Salvar", onSave }: { busy: boolean; label?: string; onSave: () => void }) {
  const { closeDialog } = useHouse();
  return (
    <div className="actions">
      <button className="primary" disabled={busy} onClick={onSave}>{label}</button>
      <button className="secondary" onClick={closeDialog}>Fechar</button>
    </div>
  );
}

/** "Pago por": a select of the house's members (only when it has partners). */
function PaidBy({ id, value, onChange, label = "Pago por" }: { id: string; value: string; onChange: (v: string) => void; label?: string }) {
  const { view, memberName, shared } = useHouse();
  if (!shared) return null;
  return <Field id={id} label={label}><Select id={id} value={value} onChange={onChange}
    options={view.members.map((m) => [m.id, memberName(m.id)])} /></Field>;
}

const defaultPaidBy = (view: HouseView, paidBy: string | undefined, has: boolean) => (has ? paidBy || view.members[0].id : view.me);

// ------------------------------------------------------------------ a renovation cost
export function ExpenseDialog({ expense }: { expense: Expense | null }) {
  const { view, viewPhoto } = useHouse();
  const house = view.house;
  const { busy, save } = useSave();
  const [f, setF] = useState({ date: formatDate(expense?.date || today()), category: expense?.category || "material",
    description: expense?.description || "", supplier: expense?.supplier || "",
    amount: expense ? centsToText(expense.amount_cents) : "", area: expense?.area_id || "",
    paidBy: defaultPaidBy(view, expense?.paid_by, Boolean(expense)) });
  const [nf, setNf] = useState<PhotoChoice>({ keep: Boolean(expense?.nf_photo), file: null });
  const [material, setMaterial] = useState<PhotoChoice>({ keep: Boolean(expense?.material_photo), file: null });
  const [label, setLabel] = useState("Salvar");
  const set = (key: keyof typeof f) => (value: string) => setF({ ...f, [key]: value });
  const photo = async (choice: PhotoChoice, current = "") => (choice.file ? uploadPhoto(house.id, choice.file) : choice.keep ? current : "");
  const onSave = () => save(async () => {
    try {
      const body: Record<string, unknown> = { date: dateValue(f.date, "Data"), category: f.category, description: f.description,
        supplier: f.supplier, amount_cents: money(f.amount, "Valor"), area_id: f.area, paid_by: view.members.length > 1 ? f.paidBy : "" };
      setLabel("Enviando fotos…");
      body.nf_photo = await photo(nf, expense?.nf_photo);
      body.material_photo = await photo(material, expense?.material_photo);
      return await (expense ? api<HouseView>("PUT", `/houses/${house.id}/expenses/${expense.id}`, body)
        : api<HouseView>("POST", `/houses/${house.id}/expenses`, body));
    } finally { setLabel("Salvar"); }
  }, "Custo salvo.");
  return (
    <Dialog title={expense ? "Editar custo" : `Novo custo: ${house.name}`} onClose={useHouse().closeDialog}>
      <Field id="e-description" label="Descrição">
        <input id="e-description" maxLength={120} placeholder="Ex.: Cimento e areia" autoFocus value={f.description}
          onChange={(e) => set("description")(e.target.value)} />
      </Field>
      <div className="two-columns">
        <div><Field id="e-date" label="Data"><DateInput id="e-date" value={f.date} onChange={set("date")} /></Field></div>
        <div><Field id="e-category" label="Categoria"><Select id="e-category" value={f.category} onChange={set("category")}
          options={Object.entries(CATEGORIES)} /></Field></div>
        <div><Field id="e-amount" label="Valor (R$)"><input id="e-amount" inputMode="decimal" placeholder="0,00" value={f.amount}
          onChange={(e) => set("amount")(e.target.value)} /></Field></div>
        <div><Field id="e-supplier" label="Fornecedor (opcional)"><input id="e-supplier" maxLength={80} value={f.supplier}
          onChange={(e) => set("supplier")(e.target.value)} /></Field></div>
      </div>
      {house.areas.length > 0
        ? <Field id="e-area" label="Área da casa"><Select id="e-area" value={f.area} onChange={set("area")}
          options={[["", "Sem área"], ...house.areas.map((a): [string, string] => [a.id, a.name])]} /></Field>
        : <p className="muted hint">Para vincular o custo a uma área (cozinha, telhado…), marque as áreas em “Editar casa”.</p>}
      <PaidBy id="e-paid-by" value={f.paidBy} onChange={set("paidBy")} />
      <div className="two-columns photo-fields">
        <PhotoField id="e-nf" label="Foto da NF" currentUrl={expense?.nf_photo_url || ""} choice={nf} onChange={setNf}
          onView={(url) => viewPhoto(url, "Foto da NF")} />
        <PhotoField id="e-material" label="Foto do material ou serviço" currentUrl={expense?.material_photo_url || ""}
          choice={material} onChange={setMaterial} onView={(url) => viewPhoto(url, "Foto do material ou serviço")} />
      </div>
      <Actions busy={busy} label={label} onSave={onSave} />
    </Dialog>
  );
}

// ------------------------------------------------------------------ recurring bills
/** Registers (or edits) the payment of a recurring bill. `preset` {name, due}: paying a bill of the list, its
 *  name is fixed. `month`: the month on screen, the one the payment refers to (a late bill paid next month). */
export function PaymentDialog({ payment, preset, month }: { payment: Expense | null; preset: { name: string; due: string } | null; month: string }) {
  const { view, closeDialog } = useHouse();
  const house = view.house;
  const { busy, save } = useSave();
  const names = [...new Map([...house.recurring_bills.map((b) => b.name),
    ...view.expenses.filter((e) => e.category === "recurring").map((e) => e.description)].map((n) => [n.toLowerCase(), n])).values()];
  const [date, setDate] = useState(formatDate(payment?.date || today()));
  const [name, setName] = useState(payment?.description || preset?.name || "");
  const [amount, setAmount] = useState(payment ? centsToText(payment.amount_cents) : "");
  const [paidBy, setPaidBy] = useState(defaultPaidBy(view, payment?.paid_by, Boolean(payment)));
  const reference = payment ? refOf(payment) : month;
  const onSave = () => save(() => {
    const body = { category: "recurring", date: dateValue(date, "Pago em"), reference, description: name,
      amount_cents: money(amount, "Valor"), paid_by: view.members.length > 1 ? paidBy : "" };
    return payment ? api<HouseView>("PUT", `/houses/${house.id}/expenses/${payment.id}`, body)
      : api<HouseView>("POST", `/houses/${house.id}/expenses`, body);
  }, "Pagamento salvo.");
  return (
    <Dialog title={payment ? "Editar pagamento" : preset ? `Pagar ${preset.name}` : `Lançar pagamento: ${house.name}`} onClose={closeDialog}>
      {preset?.due && <p className="muted">{`Vencimento: ${formatDate(preset.due)}`}</p>}
      <Field id="r-description" label="Conta">
        {preset ? <input id="r-description" readOnly value={name} />
          : <Autocomplete id="r-description" value={name} onChange={setName} options={names} placeholder="Ex.: Energia, Água, Internet" />}
      </Field>
      <div className="two-columns">
        <div><Field id="r-date" label="Pago em"><DateInput id="r-date" value={date} onChange={setDate} /></Field></div>
        <div><Field id="r-amount" label="Valor (R$)"><input id="r-amount" inputMode="decimal" placeholder="0,00" autoFocus={Boolean(preset)}
          value={amount} onChange={(e) => setAmount(e.target.value)} /></Field></div>
      </div>
      <PaidBy id="r-paid-by" value={paidBy} onChange={setPaidBy} />
      <p className="muted hint">{`Conta de ${monthName(reference)}.`}</p>
      <Actions busy={busy} onSave={onSave} />
    </Dialog>
  );
}

/** PUT /houses/{id}/recurring: the whole list of bills. */
export const saveBills = (houseId: string, list: RecurringBill[]) => api<HouseView>("PUT", `/houses/${houseId}/recurring`,
  { bills: list.map(({ name, day, until }) => ({ name, day, until: until || "" })) });

export function ScheduleDialog({ bill }: { bill: RecurringBill | null }) {
  const { view, closeDialog } = useHouse();
  const list = view.house.recurring_bills;
  const { busy, save } = useSave();
  const [name, setName] = useState(bill?.name || "");
  const [day, setDay] = useState(bill ? String(bill.day) : "");
  const onSave = () => save(() => {
    const entry = { id: bill?.id, name, day: Number(day), until: bill?.until || "" };
    return saveBills(view.house.id, bill ? list.map((x) => (x.id === bill.id ? entry : x)) : [...list, entry]);
  }, "Conta salva.");
  return (
    <Dialog title={bill ? "Editar conta" : `Cadastrar conta: ${view.house.name}`} onClose={closeDialog}>
      <Field id="s-name" label="Conta"><input id="s-name" maxLength={60} placeholder="Ex.: Energia, Água, Internet" autoComplete="off"
        autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field id="s-day" label="Vence todo dia"><input id="s-day" type="number" min={1} max={31} inputMode="numeric" placeholder="1 a 31"
        value={day} onChange={(e) => setDay(e.target.value)} /></Field>
      <p className="muted hint">Em meses mais curtos, vale o último dia do mês.</p>
      <Actions busy={busy} onSave={onSave} />
    </Dialog>
  );
}

/** Cancels a bill (the Netflix you stopped paying): it stops being charged after the month chosen, its payments
 *  stay in the history and the warnings stop. Unlike deleting it, which forgets it in every month. */
export function EndDialog({ bill, month }: { bill: RecurringBill; month: string }) {
  const { view, closeDialog } = useHouse();
  const { busy, save } = useSave();
  const [last, setLast] = useState(month);
  const onSave = () => save(() => {
    if (!last) throw new Error("Escolha o último mês da cobrança.");
    return saveBills(view.house.id, view.house.recurring_bills.map((x) => (x.id === bill.id ? { ...x, until: last } : x)));
  }, "Conta encerrada.");
  return (
    <Dialog title={`Encerrar ${bill.name}`} onClose={closeDialog}>
      <p className="muted">A conta deixa de ser cobrada depois do mês escolhido. Os pagamentos já lançados ficam no histórico.</p>
      <Field id="end-month" label="Última cobrança em"><input id="end-month" type="month" value={last} onChange={(e) => setLast(e.target.value)} /></Field>
      <Actions busy={busy} label="Encerrar" onSave={onSave} />
    </Dialog>
  );
}

// ------------------------------------------------------------------ installments
/** Adds N monthly installments at once: "120 de R$ 2.500,00, a primeira em 10/02/2026". */
export function PlanDialog({ house, bundle }: { house: House; bundle: BundleHouse[] }) {
  const { closeDialog } = useHouse();
  const grouped = bundle.length > 1;
  const { busy, save } = useSave();
  const [count, setCount] = useState("1");
  const [amount, setAmount] = useState("");
  const [first, setFirst] = useState(formatDate(today()));
  const onSave = () => save(() => api<HouseView>("POST", `/houses/${house.id}/installments`, { count: Number(count),
    amount_cents: money(amount, "Valor de cada uma"), first_due_date: dateValue(first, "Vencimento da primeira") }),
  Number(count) === 1 ? "Prestação adicionada." : `${count} prestações adicionadas.`);
  return (
    <Dialog title={`Prestações: ${house.name}`} onClose={closeDialog}>
      <div className="two-columns">
        <div><Field id="i-count" label="Quantidade"><input id="i-count" type="number" min={1} max={600} inputMode="numeric"
          value={count} onChange={(e) => setCount(e.target.value)} /></Field></div>
        <div><Field id="i-amount" label={grouped ? "Valor total de cada uma (R$)" : "Valor de cada uma (R$)"}>
          <input id="i-amount" inputMode="decimal" placeholder="0,00" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></Field></div>
      </div>
      <Field id="i-first" label="Vencimento da primeira"><DateInput id="i-first" value={first} onChange={setFirst} /></Field>
      <p className="muted hint">{grouped
        ? `Compra conjunta: o valor é da parcela inteira e é dividido entre as casas (${bundleText(bundle)}).`
        : "Uma por mês, sempre no mesmo dia. Depois dá para editar cada uma (valor, vencimento)."}</p>
      <Actions busy={busy} label="Adicionar" onSave={onSave} />
    </Dialog>
  );
}

/** One installment: its due date, its amount and the day it was paid (empty: not paid). */
export function InstallmentDialog({ inst, n, grouped: inDeal }: { inst: Installment; n: string; grouped: boolean }) {
  const { view, closeDialog } = useHouse();
  const grouped = inDeal && Boolean(inst.group_id);
  const { busy, save } = useSave();
  const [due, setDue] = useState(formatDate(inst.due_date));
  const [amount, setAmount] = useState(centsToText(grouped ? inst.total_cents : inst.amount_cents));
  const [paid, setPaid] = useState(formatDate(inst.paid_date));
  const [paidBy, setPaidBy] = useState(defaultPaidBy(view, inst.paid_by, Boolean(inst.paid_date)));
  const onSave = () => save(() => {
    const paidDate = dateValue(paid, "Paga em", false);
    const body: Record<string, unknown> = { due_date: dateValue(due, "Vencimento"),
      amount_cents: grouped ? inst.amount_cents : money(amount, "Valor"),
      paid_date: paidDate, paid_by: paidDate && view.members.length > 1 ? paidBy : "" };
    if (grouped) body.total_cents = money(amount, "Valor total");
    return api<HouseView>("PUT", `/houses/${view.house.id}/installments/${inst.id}`, body);
  }, "Prestação salva.");
  return (
    <Dialog title={`Prestação ${n}`} onClose={closeDialog}>
      <div className="two-columns">
        <div><Field id="i-due" label="Vencimento"><DateInput id="i-due" value={due} onChange={setDue} /></Field></div>
        <div><Field id="i-value" label={grouped ? "Valor total (R$)" : "Valor (R$)"}><input id="i-value" inputMode="decimal" autoFocus
          value={amount} onChange={(e) => setAmount(e.target.value)} /></Field></div>
      </div>
      {grouped && <p className="muted hint">Compra conjunta: o valor, o vencimento e o pagamento valem para todas as casas
        (o valor é dividido de novo, na mesma proporção).</p>}
      <Field id="i-paid" label="Paga em (vazio se ainda não foi paga)"><DateInput id="i-paid" value={paid} onChange={setPaid} /></Field>
      <PaidBy id="i-paid-by" label="Paga por" value={paidBy} onChange={setPaidBy} />
      <Actions busy={busy} onSave={onSave} />
    </Dialog>
  );
}

// ------------------------------------------------------------------ timeline
interface Chosen { file: File; url: string }

/** A moment of the timeline: its date, what it shows, the photos it has (each can be removed) and new ones. */
export function TimelineDialog({ entry }: { entry: TimelineEntry | null }) {
  const { view, closeDialog } = useHouse();
  const { busy, save } = useSave();
  const [date, setDate] = useState(formatDate(entry?.date || today()));
  const [caption, setCaption] = useState(entry?.caption || "");
  const [kept, setKept] = useState((entry?.photos || []).map((id, i) => ({ id, url: entry!.photo_urls[i] })));
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [label, setLabel] = useState("Salvar");
  useEffect(() => () => chosen.forEach((c) => URL.revokeObjectURL(c.url)), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const onSave = () => save(async () => {
    try {
      if (kept.length + chosen.length === 0) throw new Error("Fotos: escolha ao menos uma.");
      if (kept.length + chosen.length > 12) throw new Error("Fotos: no máximo 12 por registro.");
      const photos = kept.map((p) => p.id);
      for (const [i, c] of chosen.entries()) {
        setLabel(`Enviando foto ${i + 1} de ${chosen.length}…`);
        photos.push(await uploadPhoto(view.house.id, c.file));
      }
      const body = { date: dateValue(date, "Data"), caption, photos };
      return await (entry ? api<HouseView>("PUT", `/houses/${view.house.id}/timeline/${entry.id}`, body)
        : api<HouseView>("POST", `/houses/${view.house.id}/timeline`, body));
    } finally { setLabel("Salvar"); }
  }, "Registro salvo.");
  const thumb = (key: string, url: string, onRemove: () => void) => (
    <div key={key} className="thumb-edit"><img className="photo-thumb" src={url} alt="" />
      <button type="button" className="thumb-remove" aria-label="Tirar esta foto" onClick={onRemove}>✕</button></div>
  );
  return (
    <Dialog title={entry ? "Editar registro" : "Novo registro na timeline"} onClose={closeDialog}>
      <div className="two-columns">
        <div><Field id="t-date" label="Data"><DateInput id="t-date" value={date} onChange={setDate} /></Field></div>
        <div><Field id="t-caption" label="O que mostra (opcional)"><input id="t-caption" maxLength={200} placeholder="Ex.: Telhado novo instalado"
          autoFocus={Boolean(entry)} value={caption} onChange={(e) => setCaption(e.target.value)} /></Field></div>
      </div>
      <span className="field-label">Fotos (até 12)</span>
      <div className="thumbs" id="t-photos">
        {kept.map((p) => thumb(p.id, p.url, () => setKept(kept.filter((x) => x !== p))))}
        {chosen.map((c) => thumb(c.url, c.url, () => { URL.revokeObjectURL(c.url); setChosen(chosen.filter((x) => x !== c)); }))}
      </div>
      <input id="t-files" type="file" accept="image/*" multiple className="visually-hidden" onChange={(e) => {
        const files = [...(e.target.files || [])];
        setChosen([...chosen, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
        e.target.value = "";
      }} />
      <label htmlFor="t-files" className="file-button">Escolher fotos</label>
      <Actions busy={busy} label={label} onSave={onSave} />
    </Dialog>
  );
}
