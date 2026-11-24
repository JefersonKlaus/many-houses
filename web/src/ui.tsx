// Shared pieces of the screens: dialogs, the ⋮ actions menu, form fields, pages of a list, the name
// suggestions, a photo field and a password field with an eye. Text from the user always goes in as text.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { maskDate } from "./format";

/** A modal <dialog>: open while mounted; Esc, a click outside it or `onClose` close it. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => {       // the backdrop counts as the <dialog> itself
        const r = ref.current!.getBoundingClientRect();
        const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if (e.target === ref.current && outside) onClose();
      }}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

/** Where a screen's dialogs are open: `open(<SomeDialog .../>)`, `close()`. */
export function useDialog() {
  const [dialog, setDialog] = useState<ReactNode>(null);
  return { dialog, open: (node: ReactNode) => setDialog(node), close: () => setDialog(null) };
}

/** A photo shown big. */
export function PhotoDialog({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <img className="photo-big" src={url} alt={title} />
      <div className="actions"><button className="secondary" onClick={onClose}>Fechar</button></div>
    </Dialog>
  );
}

export interface MenuItem { text: string; onClick: () => void; danger?: boolean }

/** A "⋮" button that opens a small menu of a row's actions. The menu is fixed on the screen, so a scrolling
 *  list never cuts it; it closes when an action is chosen, on a click outside, on Esc or when the page scrolls. */
export function ActionsMenu({ label, items }: { label: string; items: (MenuItem | false | null | undefined)[] }) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const openedAt = useRef(0);
  const close = () => setStyle(null);
  const open = () => {
    const r = button.current!.getBoundingClientRect();
    openedAt.current = r.top;
    setStyle({ right: document.documentElement.clientWidth - r.right, top: r.bottom + 4 });
  };
  useLayoutEffect(() => {          // no room below: it opens upwards
    if (!style || !list.current) return;
    const r = button.current!.getBoundingClientRect();
    const height = list.current.offsetHeight;
    if (r.bottom + 4 + height > window.innerHeight && style.top === r.bottom + 4) {
      setStyle({ ...style, top: Math.max(4, r.top - 4 - height) });
    }
    list.current.querySelector("button")?.focus();
  }, [style]);
  useEffect(() => {
    if (!style) return;
    const outside = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && e.target !== button.current) close();
    };
    const keys = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); button.current?.focus(); } };
    const scrolled = () => { if (button.current?.getBoundingClientRect().top !== openedAt.current) close(); };
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", keys);
    document.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("click", outside, true);
      document.removeEventListener("keydown", keys);
      document.removeEventListener("scroll", scrolled, true);
    };
  }, [style]);
  return (
    <div className="menu">
      <button ref={button} className="kebab" title="Ações" aria-label={`Ações: ${label}`} aria-haspopup="menu"
        aria-expanded={Boolean(style)} onClick={(e) => { e.stopPropagation(); if (style) close(); else open(); }}>⋮</button>
      <div ref={list} className="menu-list" role="menu" hidden={!style} style={style ?? undefined}>
        {items.filter((x): x is MenuItem => Boolean(x)).map((item) => (
          <button key={item.text} role="menuitem" className={item.danger ? "danger-item" : undefined}
            onClick={() => { close(); item.onClick(); }}>{item.text}</button>
        ))}
      </div>
    </div>
  );
}

/** A label and its input. */
export function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <><label htmlFor={id}>{label}</label>{children}</>;
}

/** A tile of a totals row: its label, the value and a note. */
export function Tile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <div><span>{label}</span><strong>{value}</strong>{note && <small className="muted">{note}</small>}</div>;
}

/** A date field in the Brazilian format: the digits typed become "dd/mm/aaaa". */
export function DateInput({ id, value, onChange }: { id: string; value: string; onChange: (text: string) => void }) {
  return <input id={id} inputMode="numeric" maxLength={10} placeholder="dd/mm/aaaa" autoComplete="off"
    value={value} onChange={(e) => onChange(maskDate(e.target.value))} />;
}

/** A select from [[value, text]...] (the order kept). */
export function Select({ id, options, value, onChange }:
  { id: string; options: [string, string][]; value: string; onChange: (value: string) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select>
  );
}

/** Runs an action with a flag on, so the button can be disabled and a double click doesn't send it twice. */
export function useBusy(): [boolean, (action: () => Promise<unknown>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  };
  return [busy, run];
}

// ------------------------------------------------------------------ pages of a list
export const PAGE_SIZE = 10;
const SEARCH_FROM = 6;

/** Lowercase, without accents: "São José" is found by "sao jose". */
const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** "‹ 1 de 3 ›" */
export function Pager({ page, count, onPage }: { page: number; count: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  if (pages <= 1) return <div className="pager" role="navigation" aria-label="Páginas" />;
  const first = page * PAGE_SIZE + 1, last = Math.min(count, (page + 1) * PAGE_SIZE);
  return (
    <div className="pager" role="navigation" aria-label="Páginas">
      <span className="muted">{`${first}–${last} de ${count}`}</span>
      <button className="secondary small" aria-label="Página anterior" disabled={page === 0} onClick={() => onPage(page - 1)}>‹</button>
      <span className="pager-page">{`${page + 1} de ${pages}`}</span>
      <button className="secondary small" aria-label="Próxima página" disabled={page === pages - 1} onClick={() => onPage(page + 1)}>›</button>
    </div>
  );
}

/** A page of `count` rows (PAGE_SIZE at a time), opening on `start`. */
export function usePage(count: number, start = 0): [number, (page: number) => void] {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const [page, setPage] = useState(Math.min(Math.max(0, start), pages - 1));
  return [Math.min(page, pages - 1), setPage];
}

/** A list box: one row per item, a search once the list is long, and pages of PAGE_SIZE. */
export function PagedList<T>({ items, row, label, searchText }:
  { items: T[]; row: (item: T) => ReactNode; label: string; searchText: (item: T) => string }) {
  const [wanted, setWanted] = useState("");
  const shown = wanted ? items.filter((item) => plain(searchText(item)).includes(plain(wanted.trim()))) : items;
  const [page, setPage] = usePage(shown.length);
  return (
    <div className="card list-card">
      {items.length >= SEARCH_FROM && <input type="search" className="list-search" placeholder={`Buscar ${label}`}
        aria-label={`Buscar ${label}`} value={wanted} onChange={(e) => { setWanted(e.target.value); setPage(0); }} />}
      <ul className="item-list">{shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row)}</ul>
      {shown.length === 0 && <p className="muted list-empty">Nada encontrado.</p>}
      <Pager page={page} count={shown.length} onPage={setPage} />
    </div>
  );
}

// ------------------------------------------------------------------ name suggestions
/** A text input with a list of suggestions right under it, as wide as the field: the ones that contain what was
 *  typed (all of them when empty); click, or ↑ ↓ and Enter, picks one. */
export function Autocomplete({ id, value, onChange, options, placeholder }:
  { id: string; value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = value.trim().toLowerCase();
  const found = options.filter((o) => o.toLowerCase().includes(typed) && o.toLowerCase() !== typed);
  const pick = (name: string) => { onChange(name); setOpen(false); setActive(-1); };
  return (
    <div className="autocomplete">
      <input id={id} maxLength={120} placeholder={placeholder} autoComplete="off" value={value} autoFocus
        onFocus={() => setOpen(true)} onBlur={() => { setOpen(false); setActive(-1); }}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={(e) => {
          if (!open || found.length === 0) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((active + (e.key === "ArrowDown" ? 1 : -1) + found.length) % found.length);
          } else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(found[active]); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }} />
      <ul className="suggestions" role="listbox" hidden={!open || found.length === 0}>
        {found.map((o, i) => (
          <li key={o} role="option" aria-selected={i === active} className={i === active ? "active" : undefined}
            onMouseDown={(e) => { e.preventDefault(); pick(o); }}>{o}</li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ photo field
export interface PhotoChoice { keep: boolean; file: File | null }

/** One photo in a form: the one there is (tap to see it), choose another (camera or gallery) or remove it. */
export function PhotoField({ id, label, currentUrl, choice, onChange, onView }: {
  id: string; label: string; currentUrl: string; choice: PhotoChoice;
  onChange: (c: PhotoChoice) => void; onView: (url: string) => void;
}) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!choice.file) { setPreview(""); return; }
    const url = URL.createObjectURL(choice.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [choice.file]);
  const shown = preview || (choice.keep ? currentUrl : "");
  return (
    <div className="photo-field">
      <span className="field-label">{label}</span>
      <img className="photo-thumb" alt={label} hidden={!shown} src={shown || undefined} onClick={() => onView(shown)} />
      <div className="photo-actions">
        <input id={id} type="file" accept="image/*" className="visually-hidden"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) onChange({ keep: false, file }); }} />
        <label htmlFor={id} className="file-button">{shown ? "Trocar foto" : "Escolher foto"}</label>
        <button type="button" className="link danger-link" hidden={!shown}
          onClick={() => onChange({ keep: false, file: null })}>Remover</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ password with an eye
const EYE = "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z";
const EYE_OFF = "M3 3l18 18 M10.6 5.1A10.7 10.7 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 4.1 M6.6 6.6A18 18 0 0 0 1 12s4 7 11 7a10.6 10.6 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2";

export function PasswordInput(props: { id: string; value: string; onChange: (v: string) => void;
  autoComplete: string; disabled?: boolean; autoFocus?: boolean; required?: boolean }) {
  const [shown, setShown] = useState(false);
  const { onChange, ...rest } = props;
  const text = shown ? "Ocultar senha" : "Mostrar senha";
  return (
    <div className="password-field">
      <input {...rest} type={shown ? "text" : "password"} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="reveal" aria-label={text} title={text} aria-pressed={shown}
        onClick={() => setShown(!shown)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={shown ? EYE_OFF : EYE} /></svg>
      </button>
    </div>
  );
}

/** What a screen shows when there is nothing to list: a drawing, a title, a line of help and, optionally, the action. */
export function EmptyState({ art, title, children, id }: { art: "house" | "bell"; title: string; children?: ReactNode; id?: string }) {
  return (
    <div className="card empty-state" id={id}>
      <svg className="empty-art" viewBox="0 0 160 120" width="160" height="120" aria-hidden="true" focusable="false">
        <ellipse cx="80" cy="108" rx="58" ry="7" fill="var(--brand-light)" />
        {art === "house" ? (
          <>
            <path d="M28 58 80 14l52 44" fill="none" stroke="var(--brand)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M40 52v52h80V52" fill="var(--brand-light)" stroke="var(--brand)" strokeWidth="6" strokeLinejoin="round" />
            <rect x="68" y="72" width="24" height="32" rx="3" fill="var(--accent)" />
            <rect x="48" y="62" width="14" height="14" rx="2" fill="var(--surface)" stroke="var(--brand)" strokeWidth="3" />
            <rect x="98" y="62" width="14" height="14" rx="2" fill="var(--surface)" stroke="var(--brand)" strokeWidth="3" />
          </>
        ) : (
          <>
            <path d="M80 20a28 28 0 0 0-28 28v22l-10 14h76l-10-14V48a28 28 0 0 0-28-28Z"
              fill="var(--brand-light)" stroke="var(--brand)" strokeWidth="6" strokeLinejoin="round" />
            <path d="M70 92a10 10 0 0 0 20 0" fill="none" stroke="var(--brand)" strokeWidth="6" strokeLinecap="round" />
            <circle cx="80" cy="14" r="5" fill="var(--accent)" />
            <path d="m66 56 10 10 18-20" fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
      </svg>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
