// Register (house = null) or edit a house, as a page with one responsibility per step:
// 1. the house's data (name, address, date, situation), 2. the areas to renovate, 3. the value (price, costs of
// buying it, profit wanted, notes). Registering, a step "Casas desta compra" follows when more than one house was
// bought in the deal, and last the payment: how it is paid, the entrada, the installments and who bought it.
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { addMonth, centsToText, dateValue, errorText, formatDate, formatMoney, money, parseDate, percentText, toCents,
  toPercent, today } from "../../format";
import { notify } from "../../toast";
import type { House, HouseView } from "../../types";
import { DateInput, Field, Select, useBusy } from "../../ui";
import { STATUS } from "./context";

// Offered as ready-made choices; any other area can be typed in.
const AREA_SUGGESTIONS = ["Cozinha", "Banheiros", "Quartos", "Sala", "Área de serviço", "Telhado", "Fachada",
  "Quintal", "Elétrica", "Hidráulica", "Pisos", "Pintura"];

interface Draft { name: string; address: string; status: string; areas: string[]; price: string; costs: string; profit: string; notes: string }
interface Deal {
  date: string; type: "cash" | "installments"; down: string; count: string; amount: string; first: string;
  firstTyped: boolean; buyers: "me" | "partners"; ownerShare: string; partners: { phone: string; cents: string }[];
}
type Step = "dados" | "reforma" | "valor" | "casas" | "pagamento";

const draftOf = (x: House): Draft => ({ name: x.name, address: x.address, status: x.status, areas: x.areas.map((a) => a.name),
  price: centsToText(x.purchase_price_cents), costs: x.purchase_costs_cents ? centsToText(x.purchase_costs_cents) : "",
  profit: x.target_profit_percent ? percentText(x.target_profit_percent) : "", notes: x.notes });
const houseLabel = (x: Draft, i: number) => x.name.trim() || `Casa ${i + 1}`;
const has = (list: string[], name: string) => list.some((a) => a.toLowerCase() === name.toLowerCase());

export function HouseForm({ house, defaultProfit, onBack, onSaved }:
  { house: House | null; defaultProfit: number; onBack: () => void; onSaved: (view: HouseView) => void }) {
  const editing = Boolean(house);
  const blank = (): Draft => ({ name: "", address: "", status: "renovating", areas: [], price: "", costs: "", notes: "",
    profit: defaultProfit ? percentText(defaultProfit) : "" });
  const [drafts, setDrafts] = useState<Draft[]>([house ? draftOf(house) : blank()]);
  const [deal, setDeal] = useState<Deal>(() => {
    const date = house?.purchase_date || today();
    return { date: formatDate(date), type: house?.payment_type || "cash",
      down: house?.down_payment_cents ? centsToText(house.down_payment_cents) : "", count: "", amount: "",
      first: formatDate(addMonth(date)), firstTyped: false, buyers: "me", ownerShare: "", partners: [{ phone: "", cents: "" }] };
  });
  const [current, setCurrent] = useState(0);
  const [step, setStep] = useState<Step>("dados");
  const [busy, run] = useBusy();
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {        // each step starts on its first field
    window.scrollTo(0, 0);
    body.current?.querySelector<HTMLElement>("input:not([type=checkbox]):not([type=radio]), textarea")?.focus();
  }, [step, current]);

  const d = drafts[current];
  const setD = (changes: Partial<Draft>) => setDrafts(drafts.map((x, i) => (i === current ? { ...x, ...changes } : x)));
  const setDealPart = (changes: Partial<Deal>) => setDeal({ ...deal, ...changes });
  const many = drafts.length > 1;
  const go = (next: Step) => setStep(next);
  const checkValue = (x: Draft) => {
    money(x.price, "Valor do imóvel");
    money(x.costs, "Custos da compra", false);
    if (toPercent(x.profit) === null) throw new Error("Lucro desejado: informe um percentual como 30 ou 12,5");
  };
  const attempt = (action: () => void) => { try { action(); } catch (error) { notify(errorText(error), true); } };
  /** Another house of the same deal (same date and payment): it asks for all its data again. */
  const addAnother = () => {
    setDrafts([...drafts, { ...blank(), profit: drafts[0].profit }]);
    setCurrent(drafts.length);
    go("dados");
  };

  const steps: [Step, string][] = ([["dados", "Dados"], ["reforma", "Reforma"], ["valor", "Valor"], ["casas", "Casas"], ["pagamento", "Pagamento"]] as [Step, string][])
    .filter(([key]) => key !== "casas" || (!editing && many));

  // ---- 1. the house's data
  const stepData = (
    <div className="card form-step">
      <h2>Dados da casa</h2>
      <Field id="h-name" label="Nome"><input id="h-name" maxLength={80} placeholder="Ex.: Casa da Rua das Flores" value={d.name}
        onChange={(e) => setD({ name: e.target.value })} /></Field>
      <Field id="h-address" label="Endereço"><input id="h-address" maxLength={200} value={d.address}
        onChange={(e) => setD({ address: e.target.value })} /></Field>
      <div className="two-columns">
        {current === 0
          ? <div><Field id="h-date" label="Data da compra"><DateInput id="h-date" value={deal.date} onChange={(text) => {
            const iso = parseDate(text);
            setDealPart({ date: text, ...(!deal.firstTyped && iso ? { first: formatDate(addMonth(iso)) } : {}) });
          }} /></Field></div>
          : <div><p className="muted hint">{`Data da compra: ${deal.date}, a mesma da primeira casa.`}</p></div>}
        <div><Field id="h-status" label="Situação"><Select id="h-status" value={d.status} onChange={(status) => setD({ status })}
          options={Object.entries(STATUS)} /></Field></div>
      </div>
      <div className="actions">
        <button className="primary" id="h-next" onClick={() => {
          if (!d.name.trim()) return notify("Nome: preencha este campo", true);
          if (!d.address.trim()) return notify("Endereço: preencha este campo", true);
          if (!parseDate(deal.date)) return notify("Data da compra: informe a data como dd/mm/aaaa", true);
          go("reforma");
        }}>Continuar: pontos de reforma</button>
      </div>
    </div>
  );

  // ---- 2. the areas that need renovation
  const [other, setOther] = useState("");
  const chips = [...d.areas, ...AREA_SUGGESTIONS.filter((name) => !has(d.areas, name))];
  const [extra, setExtra] = useState<string[]>([]);       // typed areas unchecked again: they stay as chips
  const allChips = [...chips, ...extra.filter((name) => !has(chips, name))];
  const addOther = () => {
    const name = other.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (!has(d.areas, name)) setD({ areas: [...d.areas, name] });
    setOther("");
  };
  const stepAreas = (
    <div className="card form-step">
      <h2>Pontos de reforma</h2>
      <p className="muted hint">Marque as partes da casa que precisam de reforma. Cada custo da obra pode ser ligado a uma delas.</p>
      <div className="chips" id="h-areas">
        {allChips.map((name) => (
          <label key={name.toLowerCase()} className="chip">
            <input type="checkbox" value={name} checked={has(d.areas, name)} onChange={(e) => {
              if (e.target.checked) setD({ areas: [...d.areas, name] });
              else {
                setD({ areas: d.areas.filter((a) => a.toLowerCase() !== name.toLowerCase()) });
                if (!has(AREA_SUGGESTIONS, name)) setExtra([...extra, name]);
              }
            }} />{name}
          </label>
        ))}
      </div>
      <div className="inline-add">
        <input id="h-other-area" maxLength={40} placeholder="Outra área (ex.: Edícula)" value={other}
          onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOther(); } }} />
        <button type="button" className="secondary small" onClick={addOther}>Adicionar</button>
      </div>
      <div className="actions">
        <button className="secondary" onClick={() => go("dados")}>Voltar</button>
        <button className="primary" id="h-next" onClick={() => go("valor")}>Continuar: valor</button>
      </div>
    </div>
  );

  // ---- 3. the value
  const stepValue = (
    <div className="card form-step">
      <h2>Valor</h2>
      <div className="two-columns">
        <div><Field id="h-price" label="Valor do imóvel (R$)"><input id="h-price" inputMode="decimal" placeholder="0,00" value={d.price}
          onChange={(e) => setD({ price: e.target.value })} /></Field></div>
        <div><Field id="h-costs" label="Custos da compra (R$)"><input id="h-costs" inputMode="decimal" placeholder="0,00" value={d.costs}
          onChange={(e) => setD({ costs: e.target.value })} /></Field></div>
      </div>
      <p className="muted hint">Custos da compra: ITBI, escritura, registro, comissão do corretor, certidões…</p>
      <Field id="h-profit" label="Lucro desejado (%)"><input id="h-profit" inputMode="decimal" placeholder="Ex.: 30" value={d.profit}
        onChange={(e) => setD({ profit: e.target.value })} /></Field>
      <p className="muted hint">Sobre o total investido (compra + reforma): a página da casa mostra por quanto vender hoje.</p>
      <Field id="h-notes" label="Observações"><textarea id="h-notes" maxLength={2000} rows={3} value={d.notes}
        onChange={(e) => setD({ notes: e.target.value })} /></Field>
      <div className="actions">
        <button className="secondary" onClick={() => go("reforma")}>Voltar</button>
        <button className="primary" id="h-next" onClick={() => attempt(() => { checkValue(d); go(many ? "casas" : "pagamento"); })}>Continuar: pagamento</button>
        {!editing && <button className="secondary" id="h-add-here" onClick={() => attempt(() => { checkValue(d); addAnother(); })}>
          Comprei outra casa nesta negociação</button>}
      </div>
    </div>
  );

  // ---- the houses of this purchase (registering only)
  const prices = drafts.map((x) => toCents(x.price) || 0);
  const total = prices.reduce((a, b) => a + b, 0);
  const stepHouses = (
    <div className="card form-step">
      <h2>Casas desta negociação</h2>
      <ul className="members" id="h-houses">
        {drafts.map((x, i) => (
          <li key={i}>
            <div><strong>{houseLabel(x, i)}</strong><div className="muted">{[x.address, formatMoney(toCents(x.price) || 0),
              x.areas.length && `${x.areas.length} ponto(s) de reforma`].filter(Boolean).join(" · ")}</div></div>
            <div className="actions tight">
              <button type="button" className="link" onClick={() => { setCurrent(i); go("dados"); }}>Editar</button>
              {many && <button type="button" className="link danger-link" onClick={() => { setDrafts(drafts.filter((_, k) => k !== i)); setCurrent(0); }}>Tirar</button>}
            </div>
          </li>
        ))}
      </ul>
      {many && <p className="muted hint">{`Total dos imóveis: ${formatMoney(total)}. A entrada e as parcelas serão informadas uma vez só, `
        + "para todas as casas, e divididas pelo valor de cada imóvel."}</p>}
      <p className="muted hint">Comprou mais de uma casa de uma vez? Adicione cada uma: ela pede todos os dados de novo.</p>
      <div className="actions">
        <button className="secondary" id="h-add-more" onClick={addAnother}>+ Outra casa nesta negociação</button>
        <button className="primary" id="h-next" onClick={() => go("pagamento")}>Continuar: pagamento</button>
      </div>
    </div>
  );

  // ---- last: how it is paid
  const n = Number(deal.count), each = toCents(deal.amount), entrada = toCents(deal.down || "0");
  const summary = n > 0 && each !== null && entrada !== null
    ? `Entrada ${formatMoney(entrada)} + ${n} × ${formatMoney(each)} = ${formatMoney(entrada + n * each)}` : "";
  const shares = !many || total === 0 ? "" : "Dividido pelo valor de cada imóvel: "
    + drafts.map((x, i) => `${houseLabel(x, i)} ${percentText(Math.round((10000 * prices[i]) / total) / 100)} %`).join(" · ") + ".";
  const split = (() => {           // "Pago na compra R$ 318.000,00 · faltam R$ 18.000,00"
    const sumOf = (texts: string[]) => texts.reduce<number | null>((s, t) => (s === null || toCents(t || "0") === null ? null : s + toCents(t || "0")!), 0);
    const paid = deal.type === "installments" ? toCents(deal.down || "0") : sumOf(drafts.map((x) => x.price));
    const costs = sumOf(drafts.map((x) => x.costs));
    const whole = paid === null || costs === null ? null : paid + costs;
    const parts = [deal.ownerShare, ...deal.partners.map((p) => p.cents)].map((v) => toCents(v || "0"));
    if (!whole || parts.some((v) => v === null)) return "";
    const sum = parts.reduce<number>((a, b) => a + b!, 0);
    return `Pago na compra: ${formatMoney(whole)} · ` + (sum === whole ? "a divisão fecha." : `${sum < whole ? "faltam" : "passam"} ${formatMoney(Math.abs(whole - sum))}.`);
  })();
  const setPartner = (i: number, changes: Partial<Deal["partners"][number]>) =>
    setDealPart({ partners: deal.partners.map((p, k) => (k === i ? { ...p, ...changes } : p)) });
  const save = () => run(async () => {
    try {
      const target = (x: Draft) => {
        const value = toPercent(x.profit);
        if (value === null) throw new Error("Lucro desejado: informe um percentual como 30 ou 12,5");
        return value;
      };
      const data = (x: Draft) => ({ name: x.name, address: x.address, status: x.status, notes: x.notes,
        purchase_price_cents: money(x.price, "Valor do imóvel"), purchase_costs_cents: money(x.costs, "Custos da compra", false),
        target_profit_percent: target(x), areas: x.areas });
      const sent: Record<string, unknown> = { ...data(drafts[0]), purchase_date: dateValue(deal.date, "Data da compra"), payment_type: deal.type };
      if (deal.type === "installments") {
        sent.down_payment_cents = money(deal.down, "Entrada", false);
        if (!editing) {
          if (!(Number(deal.count) >= 1)) throw new Error("Quantidade de parcelas: informe quantas são");
          sent.installments = { count: Number(deal.count), amount_cents: money(deal.amount, "Valor de cada parcela"),
            first_due_date: dateValue(deal.first, "Data da primeira parcela") };
        }
      }
      if (!editing && many) sent.also_bought = drafts.slice(1).map(data);
      if (!editing && deal.buyers === "partners") {
        sent.owner_share_cents = money(deal.ownerShare, "Sua parte na compra", false);
        sent.partners = deal.partners.map((p) => ({ phone: p.phone.trim(), cents: money(p.cents, "Quanto o sócio pagou", false) }));
        if (deal.partners.length === 0) throw new Error("Sócios: adicione ao menos um, ou marque “Só eu”");
      }
      const view = house ? await api<HouseView>("PUT", `/houses/${house.id}`, sent) : await api<HouseView>("POST", "/houses", sent);
      notify(many ? "Casas salvas." : "Casa salva.");
      onSaved(view);
    } catch (error) { notify(errorText(error), true); }
  });
  const stepPayment = (
    <div className="card form-step">
      <h2>Pagamento</h2>
      {many && <p className="muted hint">{`Compra de ${drafts.length} casas (${formatMoney(total)}): a entrada e as parcelas abaixo valem para todas juntas.`}</p>}
      <fieldset className="choices"><legend>Forma de pagamento</legend>
        {([["cash", "À vista"], ["installments", "Parcelado"]] as const).map(([value, text]) => (
          <label key={value} className="choice"><input type="radio" name="h-payment" value={value} checked={deal.type === value}
            onChange={() => setDealPart({ type: value })} />{text}</label>
        ))}
      </fieldset>
      <div className="installments-fields" hidden={deal.type !== "installments"}>
        <div className="two-columns">
          <div><Field id="h-down" label={many ? "Entrada total (R$)" : "Entrada (R$)"}><input id="h-down" inputMode="decimal" placeholder="0,00"
            value={deal.down} onChange={(e) => setDealPart({ down: e.target.value })} /></Field></div>
          {!editing && <>
            <div><Field id="h-count" label="Quantidade de parcelas"><input id="h-count" type="number" min={1} max={600} inputMode="numeric"
              placeholder="Ex.: 120" value={deal.count} onChange={(e) => setDealPart({ count: e.target.value })} /></Field></div>
            <div><Field id="h-amount" label={many ? "Valor total de cada parcela (R$)" : "Valor de cada parcela (R$)"}>
              <input id="h-amount" inputMode="decimal" placeholder="0,00" value={deal.amount} onChange={(e) => setDealPart({ amount: e.target.value })} /></Field></div>
            <div><Field id="h-first" label="Data da primeira parcela"><DateInput id="h-first" value={deal.first}
              onChange={(first) => setDealPart({ first, firstTyped: true })} /></Field></div>
          </>}
        </div>
        {editing ? <p className="muted hint">As prestações são alteradas na página da casa.</p>
          : <><p className="muted hint" id="h-summary">{summary}</p><p className="muted hint" id="h-bundle-note">{shares}</p></>}
      </div>
      {!editing && <>
        <fieldset className="choices"><legend>Quem comprou</legend>
          {([["me", "Só eu"], ["partners", "Com sócios"]] as const).map(([value, text]) => (
            <label key={value} className="choice"><input type="radio" name="h-buyers" value={value} checked={deal.buyers === value}
              onChange={() => setDealPart({ buyers: value })} />{text}</label>
          ))}
        </fieldset>
        <div className="installments-fields buyers-fields" hidden={deal.buyers !== "partners"}>
          <Field id="h-owner-share" label="Sua parte na compra (R$)"><input id="h-owner-share" inputMode="decimal" placeholder="0,00"
            value={deal.ownerShare} onChange={(e) => setDealPart({ ownerShare: e.target.value })} /></Field>
          <label>Sócios: celular e quanto cada um pagou na compra</label>
          <div id="h-partners">
            {deal.partners.map((p, i) => (
              <div key={i} className="partner-row">
                <input className="p-phone" type="tel" inputMode="numeric" maxLength={11} placeholder="Celular" aria-label="Celular do sócio (DDD + número)"
                  value={p.phone} onChange={(e) => setPartner(i, { phone: e.target.value })} />
                <input className="p-cents" inputMode="decimal" placeholder="Valor (R$)" aria-label="Quanto o sócio pagou (R$)"
                  value={p.cents} onChange={(e) => setPartner(i, { cents: e.target.value })} />
                <button type="button" className="link danger-link" aria-label="Tirar este sócio"
                  onClick={() => setDealPart({ partners: deal.partners.filter((_, k) => k !== i) })}>✕</button>
              </div>
            ))}
          </div>
          <button type="button" className="secondary small" onClick={() => {
            setDealPart({ partners: [...deal.partners, { phone: "", cents: "" }] });
            setTimeout(() => document.querySelector<HTMLInputElement>("#h-partners .partner-row:last-child .p-phone")?.focus());
          }}>+ Sócio</button>
          <p className="muted hint" id="h-split">{split}</p>
          <p className="muted hint">{many
            ? "Informe quanto cada um pagou no total (entrada + custos de todas as casas): a parte de cada um é dividida entre as casas. Cada sócio recebe um convite em cada casa."
            : "Cada sócio recebe um convite no celular. A divisão da compra é definida só aqui, no cadastro."}</p>
        </div>
      </>}
      <div className="actions">
        <button className="secondary" onClick={() => go(many ? "casas" : "valor")}>Voltar</button>
        <button className="primary" id="h-save" disabled={busy} onClick={save}>{editing ? "Salvar" : many ? "Salvar as casas" : "Salvar casa"}</button>
      </div>
    </div>
  );

  return (
    <div ref={body}>
      <button className="link back" onClick={onBack}>{house ? `‹ ${house.name}` : "‹ Casas"}</button>
      <h1>{house ? `Editar ${house.name}` : "Nova casa"}</h1>
      {["dados", "reforma", "valor"].includes(step) && !editing && many
        && <p className="muted" id="h-which">{`Casa ${current + 1} de ${drafts.length}: ${houseLabel(d, current)}`}</p>}
      <ol className="stepper" aria-label="Passos do cadastro">
        {steps.map(([key, label]) => (
          <li key={key} className={key === step ? "current" : undefined} aria-current={key === step ? "step" : undefined}>
            {editing ? <button type="button" className="step-button" onClick={() => go(key)}>{label}</button>
              : <span className="step-button">{label}</span>}
          </li>
        ))}
      </ol>
      {{ dados: stepData, reforma: stepAreas, valor: stepValue, casas: stepHouses, pagamento: stepPayment }[step]}
    </div>
  );
}
