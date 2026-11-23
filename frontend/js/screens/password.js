// Alterar senha (Perfil > Segurança): the current password and the new one twice, changed straight
// with Cognito. Without a login (the local server) there is no password: the form says so.
import { changePassword } from "../auth.js";
import { CONFIG } from "../config.js";
import { h, notify, openDialog, revealable, whileDisabled } from "../util.js";

export function passwordDialog() {
  const input = (id, autocomplete) => h("input", { id, type: "password", required: true, autocomplete,
    disabled: Boolean(CONFIG.skipLogin) });
  const current = input("p-current", "current-password");
  const proposed = input("p-new", "new-password");
  const again = input("p-again", "new-password");
  const save = h("button", { className: "primary", type: "submit", disabled: Boolean(CONFIG.skipLogin) }, "Trocar senha");
  const form = h("form", { id: "password-form" },
    CONFIG.skipLogin && h("p", { className: "notice-warn" },
      "No modo local não há login, então não há senha: a troca funciona no sistema publicado."),
    h("label", { htmlFor: "p-current" }, "Senha atual"), revealable(current),
    h("label", { htmlFor: "p-new" }, "Nova senha"), revealable(proposed),
    h("label", { htmlFor: "p-again" }, "Repita a nova senha"), revealable(again),
    h("p", { className: "muted hint" }, "10 caracteres ou mais, com maiúscula, minúscula e número."),
    h("div", { className: "actions" }, save,
      h("button", { type: "button", className: "secondary", onclick: () => dialog.close() }, "Fechar")));
  const dialog = openDialog("Alterar senha", form);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    whileDisabled(save, async () => {
      try {
        if (proposed.value !== again.value) throw new Error("A nova senha e a repetição não são iguais.");
        await changePassword(current.value, proposed.value);
        notify("Senha trocada.");
        dialog.close();
      } catch (error) { notify(error.message, true); }
    });
  });
  if (!CONFIG.skipLogin) current.focus();
}
