// Casas: every house with what it cost (purchase + renovation), and each house's page. The screen is one of
// three: the list, a house's page or the house form. Every change answers the house's whole page, which is
// drawn at once: one request per change, never two.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { errorText, formatMoney } from "../../format";
import { useNotices } from "../../notices";
import { notify } from "../../toast";
import type { House, HouseSummary, HouseView, Settings } from "../../types";
import { EmptyState, PagedList, PhotoDialog, Tile, useBusy, useDialog } from "../../ui";
import { Badge, HouseProvider, memberNamer } from "./context";
import { HouseForm } from "./HouseForm";
import { HousePage, type PageMemory } from "./HousePage";

type Screen =
  | { kind: "list" }
  | { kind: "loading" }
  | { kind: "house"; view: HouseView }
  | { kind: "form"; house: House | null; defaultProfit: number; view?: HouseView };

/** `params` {house, tab}: open that house on that tab (what a notice in Avisos links to); without them, the list. */
export function Houses({ params }: { params?: { house?: string; tab?: string } }) {
  const { report } = useNotices();
  const memory = useRef<PageMemory>({ tab: {}, month: {} }).current;
  const [screen, setScreen] = useState<Screen>({ kind: params?.house ? "loading" : "list" });
  const dialogs = useDialog();

  const show = useCallback((view: HouseView) => {
    report({ house: { id: view.house.id, due_soon: view.due_soon || [] } });
    setScreen({ kind: "house", view });
  }, [report]);
  const open = useCallback(async (id: string) => {
    setScreen({ kind: "loading" });
    try { show(await api<HouseView>("GET", `/houses/${id}`)); }
    catch (error) { notify(errorText(error), true); setScreen({ kind: "list" }); }
  }, [show]);
  useEffect(() => {
    if (!params?.house) return;
    if (params.tab) memory.tab[params.house] = params.tab;
    open(params.house);
  }, [params, memory, open]);

  if (screen.kind === "loading") return <p className="notice">Carregando…</p>;
  if (screen.kind === "list") {
    return <HouseList onOpen={open} onNew={(defaultProfit) => setScreen({ kind: "form", house: null, defaultProfit })} />;
  }
  if (screen.kind === "form") {
    return <HouseForm house={screen.house} defaultProfit={screen.defaultProfit}
      onBack={() => (screen.view ? setScreen({ kind: "house", view: screen.view }) : setScreen({ kind: "list" }))}
      onSaved={show} />;
  }
  const { view } = screen;
  const context = {
    view, show, openDialog: dialogs.open, closeDialog: dialogs.close,
    viewPhoto: (url: string, title: string) => dialogs.open(<PhotoDialog url={url} title={title} onClose={dialogs.close} />),
    memberName: memberNamer(view.members, view.me, view.role), shared: view.members.length > 1,
  };
  return (
    <HouseProvider value={context}>
      <HousePage key={view.house.id} memory={memory} onBack={() => setScreen({ kind: "list" })}
        onEdit={() => setScreen({ kind: "form", house: view.house, defaultProfit: 0, view })}
        onDeleted={() => setScreen({ kind: "list" })} />
      {dialogs.dialog}
    </HouseProvider>
  );
}

/** Every house; sold houses are hidden from the list (and its totals) unless asked for. */
function HouseList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: (defaultProfit: number) => void }) {
  const { report } = useNotices();
  const [all, setAll] = useState<HouseSummary[] | null>(null);
  const [failed, setFailed] = useState("");
  const [showSold, setShowSold] = useState(false);
  const [busy, run] = useBusy();
  useEffect(() => {
    api<HouseSummary[]>("GET", "/houses").then((houses) => { report({ houses }); setAll(houses); }, (e) => setFailed(errorText(e)));
  }, [report]);
  /** The form of a new house, with the profit wanted set in Configurações already filled in. */
  const newHouse = () => run(async () => {
    let profit = 0;
    try { profit = (await api<Settings>("GET", "/settings")).default_profit_percent; } catch { /* the field starts empty */ }
    onNew(profit);
  });
  if (failed) return <p className="notice">{failed}</p>;
  if (!all) return <p className="notice">Carregando…</p>;
  const sold = all.filter((x) => x.status === "sold").length;
  const houses = showSold ? all : all.filter((x) => x.status !== "sold");
  const sum = (key: "purchase_cents" | "renovation_cents" | "total_cents") => houses.reduce((total, x) => total + x.totals[key], 0);
  const newButton = <button className="primary" disabled={busy} onClick={newHouse}>Nova casa</button>;
  return (
    <>
      <div className="row"><h1>Casas{houses.length > 0 && <span className="count">{` (${houses.length})`}</span>}</h1>{newButton}</div>
      {houses.length > 0 && (
        <div className="totals" id="portfolio">
          <Tile label="Compras" value={formatMoney(sum("purchase_cents"))} />
          <Tile label="Reformas" value={formatMoney(sum("renovation_cents"))} />
          <Tile label="Total investido" value={formatMoney(sum("total_cents"))} />
        </div>
      )}
      {all.length === 0
        ? <EmptyState art="house" title="Nenhuma casa ainda">
          <p className="muted">Cadastre a primeira casa comprada e acompanhe os custos da reforma.</p>{newButton}</EmptyState>
        : houses.length === 0 ? <EmptyState art="house" title="Nenhuma casa à venda ou em reforma"><p className="muted">As casas vendidas estão ocultas; use “Mostrar vendidas” abaixo.</p></EmptyState>
          : <PagedList items={houses} label="casas (nome ou endereço)" searchText={(x) => `${x.name} ${x.address}`} row={(x) => (
            <li key={x.id} className="list-item clickable" tabIndex={0} role="button" onClick={() => onOpen(x.id)}
              onKeyDown={(e) => { if (e.key === "Enter") onOpen(x.id); }}>
              <div className="list-main">
                <div className="list-title">
                  <strong>{x.name}<Badge status={x.status} />
                    {(x.role === "partner" || x.partners.length > 0) && <span className="badge partner">Com sócios</span>}
                    {x.bundle_id && <span className="badge partner">Compra conjunta</span>}</strong>
                  <strong className="amount">{formatMoney(x.totals.total_cents)}</strong>
                </div>
                <div className="list-title muted">
                  <span>{x.address}</span>
                  <span>{`compra ${formatMoney(x.totals.purchase_cents)} · reforma ${formatMoney(x.totals.renovation_cents)}`}
                    {x.target_profit_percent > 0 && x.status !== "sold" && ` · vender por ${formatMoney(x.totals.sale.suggested_price_cents)}`}</span>
                </div>
              </div>
              <span className="chevron" aria-hidden="true">›</span>
            </li>
          )} />}
      {sold > 0 && <div className="actions"><button className="link" id="toggle-sold" onClick={() => setShowSold(!showSold)}>
        {showSold ? "Ocultar vendidas" : `Mostrar vendidas (${sold})`}</button></div>}
    </>
  );
}
