// Configurações (at the bottom of the menu): the user's data (the name partners see; the login's phone and
// e-mail) and the defaults (the profit wanted a new house starts with). The password: "Alterar senha", in the menu.
import { api } from "../api.js";
import { formatPhone, h, notify, percentText, render, toPercent, whileDisabled } from "../util.js";

export async function mount(container) {
  render(container, h("p", { className: "notice" }, "Carregando…"));
  let settings;
  try { settings = await api("GET", "/settings"); }
  catch (error) { return render(container, h("p", { className: "notice" }, error.message)); }
  const field = (id, label, input, hint) => [h("label", { htmlFor: id }, label), input,
    hint && h("p", { className: "muted hint" }, hint)];

  // the name and the default profit are saved together (PUT /settings)
  const name = h("input", { id: "s-name", maxLength: 80, value: settings.name, autocomplete: "name" });
  const profit = h("input", { id: "s-profit", inputMode: "decimal", placeholder: "Ex.: 30",
    value: settings.default_profit_percent ? percentText(settings.default_profit_percent) : "" });
  const save = async (button, message) => whileDisabled(button, async () => {
    try {
      const target = toPercent(profit.value);
      if (target === null) throw new Error("Lucro desejado padrão: informe um percentual como 30 ou 12,5");
      settings = await api("PUT", "/settings", { name: name.value, default_profit_percent: target });
      name.value = settings.name;
      notify(message);
    } catch (error) { notify(error.message, true); }
  });
  const saveData = h("button", { className: "primary", type: "submit" }, "Salvar");
  const saveDefaults = h("button", { className: "primary", type: "submit" }, "Salvar");
  const form = (id, title, button, message, ...children) => {
    const element = h("form", { className: "card settings", id }, h("h2", {}, title), ...children,
      h("div", { className: "actions" }, button));
    element.addEventListener("submit", (e) => { e.preventDefault(); save(button, message); });
    return element;
  };

  render(container,
    h("h1", {}, "Configurações"),
    form("settings-data", "Seus dados", saveData, "Dados salvos.",
      field("s-name", "Nome", name, "É como seus sócios veem você nas casas compartilhadas."),
      h("dl", { className: "details" },
        h("dt", {}, "Celular"), h("dd", {}, formatPhone(settings.phone) || "—"),
        h("dt", {}, "E-mail"), h("dd", {}, settings.email || "—")),
      h("p", { className: "muted hint" }, "O celular (seu login) e o e-mail não mudam por aqui: "
        + "para trocá-los, fale com quem administra o sistema.")),
    form("settings-defaults", "Padrões", saveDefaults, "Padrões salvos.",
      field("s-profit", "Lucro desejado padrão (%)", profit,
        "Já vem preenchido ao cadastrar uma casa nova; em cada casa dá para mudar.")));
}
