// The Configurações group, at the bottom of the menu:
// - Perfil: who the user is and how they log in. The name partners see (it can be changed), the login's
//   phone and e-mail (read only), and Segurança with "Alterar senha".
// - Predefinições: the values the system starts with: the profit wanted a new house starts with.
// Both save with PUT /settings, which takes the name and the default profit together.
import { api } from "../api.js";
import { formatPhone, h, notify, percentText, render, toPercent, whileDisabled } from "../util.js";
import { passwordDialog } from "./password.js";

const field = (id, label, input, hint) => [h("label", { htmlFor: id }, label), input,
  hint && h("p", { className: "muted hint" }, hint)];

/** Loads the settings, then draws the page; `draw(settings, save)` gives its cards.
 *  `save(changes)` saves them with what the other page has (PUT /settings takes both). */
async function page(container, title, draw) {
  render(container, h("p", { className: "notice" }, "Carregando…"));
  let settings;
  try { settings = await api("GET", "/settings"); }
  catch (error) { return render(container, h("p", { className: "notice" }, error.message)); }
  const save = async (changes) => {
    settings = await api("PUT", "/settings", { name: settings.name, default_profit_percent: settings.default_profit_percent,
      ...changes });
    return settings;
  };
  render(container, h("h1", {}, title), draw(settings, save));
}

/** A card that is a form: its fields and a Salvar button; `onSave()` runs with the button disabled. */
function formCard(id, title, children, onSave) {
  const button = h("button", { className: "primary", type: "submit" }, "Salvar");
  const form = h("form", { className: "card settings", id }, h("h2", {}, title), children,
    h("div", { className: "actions" }, button));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    whileDisabled(button, async () => { try { await onSave(); } catch (error) { notify(error.message, true); } });
  });
  return form;
}

export function mountProfile(container) {
  return page(container, "Perfil", (settings, save) => {
    const name = h("input", { id: "s-name", maxLength: 80, value: settings.name, autocomplete: "name" });
    return [
      formCard("settings-data", "Seus dados", [
        field("s-name", "Nome", name, "É como seus sócios veem você nas casas compartilhadas."),
        h("dl", { className: "details" },
          h("dt", {}, "Celular"), h("dd", {}, formatPhone(settings.phone) || "—"),
          h("dt", {}, "E-mail"), h("dd", {}, settings.email || "—")),
        h("p", { className: "muted hint" }, "O celular (seu login) e o e-mail não mudam por aqui: "
          + "para trocá-los, fale com quem administra o sistema."),
      ], async () => {
        name.value = (await save({ name: name.value })).name;
        notify("Dados salvos.");
      }),
      h("section", { className: "card settings", id: "settings-security" }, h("h2", {}, "Segurança"),
        h("p", { className: "muted" }, "A senha que você usa para entrar com o seu celular."),
        h("div", { className: "actions" },
          h("button", { className: "secondary", id: "change-password", onclick: passwordDialog }, "Alterar senha"))),
    ];
  });
}

export function mountDefaults(container) {
  return page(container, "Predefinições", (settings, save) => {
    const profit = h("input", { id: "s-profit", inputMode: "decimal", placeholder: "Ex.: 30",
      value: settings.default_profit_percent ? percentText(settings.default_profit_percent) : "" });
    return formCard("settings-defaults", "Casas novas", [
      field("s-profit", "Lucro desejado padrão (%)", profit,
        "Já vem preenchido ao cadastrar uma casa nova; em cada casa dá para mudar."),
    ], async () => {
      const target = toPercent(profit.value);
      if (target === null) throw new Error("Lucro desejado padrão: informe um percentual como 30 ou 12,5");
      await save({ default_profit_percent: target });
      notify("Predefinições salvas.");
    });
  });
}
