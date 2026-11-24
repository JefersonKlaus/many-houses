// The app's shell: the login screen, then the layout (top bar on phones, sidebar with the menu and the
// Configurações group) and the page open. Pages are plain state, like the old app: there are few of them
// and a house opens with params ({house, tab}), so no router library is needed.
import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { isSignedIn, setNewPassword, signIn, signOut, type Challenge } from "./auth";
import { CONFIG } from "./config";
import { Logo } from "./Logo";
import { NoticesProvider, useNotices } from "./notices";
import { Placeholder } from "./screens/Placeholder";
import { notify, Toasts } from "./toast";
import type { HouseSummary, PendingInvite } from "./types";

export type PageName = "Casas" | "Avisos" | "Perfil" | "Predefinições";
export interface Page { name: PageName; params?: { house?: string; tab?: string } }
export type Go = (name: PageName, params?: Page["params"]) => void;

const MENU: PageName[] = ["Casas", "Avisos"];
const SETTINGS: PageName[] = ["Perfil", "Predefinições"];

export function App() {
  const [signedIn, setSignedIn] = useState(isSignedIn());
  return (
    <NoticesProvider>
      {signedIn ? <Layout /> : <Login onDone={() => setSignedIn(true)} />}
      <Toasts />
    </NoticesProvider>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (challenge) { await setNewPassword(challenge, password); return onDone(); }
      const r = await signIn(phone.trim(), password);
      if (r.challenge) { setChallenge(r.challenge); setPassword(""); return; }
      onDone();
    } catch (error) { notify((error as Error).message, true); }
    finally { setBusy(false); }
  };
  return (
    <main className="login-page">
      <form className="card login" onSubmit={submit}>
        <div className="login-head">
          <Logo size={56} />
          <p className="muted">Compra, reforma e venda das suas casas, em um só lugar.</p>
        </div>
        {challenge && <p className="muted">Primeiro acesso: escolha a sua senha (10+ caracteres, com maiúscula, minúscula e número).</p>}
        {!challenge && <>
          <label htmlFor="l-phone">Celular (DDD + número)</label>
          <input id="l-phone" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="11987654321"
            maxLength={11} required title="DDD + número, só os dígitos (10 ou 11)" autoFocus
            value={phone} onChange={(e) => setPhone(e.target.value)} />
        </>}
        <label htmlFor="l-password">{challenge ? "Nova senha" : "Senha"}</label>
        <input id="l-password" type="password" required autoFocus={Boolean(challenge)}
          autoComplete={challenge ? "new-password" : "current-password"}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>{challenge ? "Definir senha" : "Entrar"}</button>
        </div>
      </form>
    </main>
  );
}

function Layout() {
  const [page, setPage] = useState<Page>({ name: "Casas" });
  const [drawer, setDrawer] = useState(false);
  const { count, report } = useNotices();
  const go: Go = (name, params) => { setPage({ name, params }); setDrawer(false); };

  useEffect(() => {          // once on entering: the number of notices is there from the start
    Promise.all([api<HouseSummary[]>("GET", "/houses"), api<PendingInvite[]>("GET", "/invites")])
      .then(([houses, invites]) => report({ houses, invites })).catch(() => {});
  }, [report]);
  useEffect(() => {          // on phones the sidebar is a drawer: Esc closes it
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { document.body.classList.add("signed-in"); }, []);

  const menuButton = (name: PageName, className?: string) => (
    <button key={name} className={className} aria-current={page.name === name ? "page" : undefined} onClick={() => go(name)}>
      {name}
      {name === "Avisos" && count > 0 && <span className="menu-count" id="notice-count" aria-label="avisos">{count > 99 ? "99+" : count}</span>}
    </button>
  );

  return (
    <>
      <header id="top-bar">
        <button id="menu-toggle" className="icon" aria-controls="sidebar" aria-expanded={drawer}
          aria-label={drawer ? "Fechar menu" : "Abrir menu"} onClick={() => setDrawer(!drawer)}>☰</button>
        <Logo size={28} />
      </header>
      <div className="layout">
        <aside id="sidebar" aria-label="Menu" className={drawer ? "open" : undefined}>
          <span className="brand"><Logo size={34} /></span>
          <nav id="menu">{MENU.map((name) => menuButton(name))}</nav>
          <div className="sidebar-footer">
            <nav className="menu-group" aria-labelledby="settings-title">
              <span id="settings-title" className="menu-group-title">Configurações</span>
              {SETTINGS.map((name) => menuButton(name, "link"))}
            </nav>
            {CONFIG.skipLogin
              ? <span id="local-mode" className="muted">Modo local, sem login</span>
              : <button id="logout" className="link" onClick={() => { signOut(); location.reload(); }}>Sair</button>}
          </div>
        </aside>
        {drawer && <div id="backdrop" onClick={() => setDrawer(false)} />}
        <main id="content">
          <Placeholder key={page.name + JSON.stringify(page.params ?? {})} name={page.name} />
        </main>
      </div>
    </>
  );
}
