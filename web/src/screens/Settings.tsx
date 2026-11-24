// The Configurações group, at the bottom of the menu:
// - Perfil: the name partners see (it can be changed), the login's phone and e-mail (read only), and
//   Segurança with "Alterar senha".
// - Predefinições: the profit wanted a new house starts with.
// Both save with PUT /settings, which takes the name and the default profit together.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../api";
import { changePassword } from "../auth";
import { CONFIG } from "../config";
import { errorText, formatPhone, percentText, toPercent } from "../format";
import { notify } from "../toast";
import type { Settings } from "../types";
import { Dialog, useBusy, useDialog, PasswordInput } from "../ui";

/** Loads the settings; `save(changes)` sends them with what the other page has (PUT /settings takes both). */
function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [failed, setFailed] = useState("");
  useEffect(() => { api<Settings>("GET", "/settings").then(setSettings, (e) => setFailed(errorText(e))); }, []);
  const save = async (changes: Partial<Settings>) => {
    const saved = await api<Settings>("PUT", "/settings", { name: settings!.name,
      default_profit_percent: settings!.default_profit_percent, ...changes });
    setSettings(saved);
    return saved;
  };
  return { settings, failed, save };
}

/** A card that is a form: its fields and a Salvar button. */
function FormCard({ id, title, children, onSave }: { id: string; title: string; children: ReactNode; onSave: () => Promise<void> }) {
  const [busy, run] = useBusy();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => { try { await onSave(); } catch (error) { notify(errorText(error), true); } });
  };
  return (
    <form className="card settings" id={id} onSubmit={submit}>
      <h2>{title}</h2>
      {children}
      <div className="actions"><button className="primary" type="submit" disabled={busy}>Salvar</button></div>
    </form>
  );
}

export function Profile() {
  const { settings, failed, save } = useSettings();
  const [name, setName] = useState<string | null>(null);
  const dialogs = useDialog();
  if (failed) return <p className="notice">{failed}</p>;
  if (!settings) return <p className="notice">Carregando…</p>;
  return (
    <>
      <h1>Perfil</h1>
      <FormCard id="settings-data" title="Seus dados" onSave={async () => {
        setName((await save({ name: name ?? settings.name })).name);
        notify("Dados salvos.");
      }}>
        <label htmlFor="s-name">Nome</label>
        <input id="s-name" maxLength={80} autoComplete="name" value={name ?? settings.name} onChange={(e) => setName(e.target.value)} />
        <p className="muted hint">É como seus sócios veem você nas casas compartilhadas.</p>
        <dl className="details">
          <dt>Celular</dt><dd>{formatPhone(settings.phone) || "—"}</dd>
          <dt>E-mail</dt><dd>{settings.email || "—"}</dd>
        </dl>
        <p className="muted hint">O celular (seu login) e o e-mail não mudam por aqui: para trocá-los, fale com quem administra o sistema.</p>
      </FormCard>
      <section className="card settings" id="settings-security">
        <h2>Segurança</h2>
        <p className="muted">A senha que você usa para entrar com o seu celular.</p>
        <div className="actions">
          <button className="secondary" id="change-password" onClick={() => dialogs.open(<PasswordDialog onClose={dialogs.close} />)}>
            Alterar senha
          </button>
        </div>
      </section>
      {dialogs.dialog}
    </>
  );
}

export function Defaults() {
  const { settings, failed, save } = useSettings();
  const [profit, setProfit] = useState<string | null>(null);
  if (failed) return <p className="notice">{failed}</p>;
  if (!settings) return <p className="notice">Carregando…</p>;
  const initial = settings.default_profit_percent ? percentText(settings.default_profit_percent) : "";
  return (
    <>
      <h1>Predefinições</h1>
      <FormCard id="settings-defaults" title="Casas novas" onSave={async () => {
        const target = toPercent(profit ?? initial);
        if (target === null) throw new Error("Lucro desejado padrão: informe um percentual como 30 ou 12,5");
        await save({ default_profit_percent: target });
        notify("Predefinições salvas.");
      }}>
        <label htmlFor="s-profit">Lucro desejado padrão (%)</label>
        <input id="s-profit" inputMode="decimal" placeholder="Ex.: 30" value={profit ?? initial} onChange={(e) => setProfit(e.target.value)} />
        <p className="muted hint">Já vem preenchido ao cadastrar uma casa nova; em cada casa dá para mudar.</p>
      </FormCard>
    </>
  );
}

/** Alterar senha: the current password and the new one twice, changed straight with Cognito. Without a login
 *  (the local server) there is no password: the form says so. */
function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [proposed, setProposed] = useState("");
  const [again, setAgain] = useState("");
  const [busy, run] = useBusy();
  const local = Boolean(CONFIG.skipLogin);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      try {
        if (proposed !== again) throw new Error("A nova senha e a repetição não são iguais.");
        await changePassword(current, proposed);
        notify("Senha trocada.");
        onClose();
      } catch (error) { notify(errorText(error), true); }
    });
  };
  return (
    <Dialog title="Alterar senha" onClose={onClose}>
      <form id="password-form" onSubmit={submit}>
        {local && <p className="notice-warn">No modo local não há login, então não há senha: a troca funciona no sistema publicado.</p>}
        <label htmlFor="p-current">Senha atual</label>
        <PasswordInput id="p-current" value={current} onChange={setCurrent} autoComplete="current-password" disabled={local} autoFocus={!local} required />
        <label htmlFor="p-new">Nova senha</label>
        <PasswordInput id="p-new" value={proposed} onChange={setProposed} autoComplete="new-password" disabled={local} required />
        <label htmlFor="p-again">Repita a nova senha</label>
        <PasswordInput id="p-again" value={again} onChange={setAgain} autoComplete="new-password" disabled={local} required />
        <p className="muted hint">10 caracteres ou mais, com maiúscula, minúscula e número.</p>
        <div className="actions">
          <button className="primary" type="submit" disabled={local || busy}>Trocar senha</button>
          <button type="button" className="secondary" onClick={onClose}>Fechar</button>
        </div>
      </form>
    </Dialog>
  );
}
