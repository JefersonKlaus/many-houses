import { CONFIG } from "./config.js";
import { isSignedIn, setNewPassword, signIn, signOut } from "./auth.js";
import { h, notify, render, revealable, whileDisabled } from "./util.js";
import { mount as houses } from "./screens/houses.js";
import { mountDefaults, mountProfile } from "./screens/settings.js";

const content = document.getElementById("content");
const SCREENS = [["Casas", houses]];             // [name in the menu, mount]; the settings are at its bottom

function loginScreen(challenge = null) {
  // DDD + number, digits only (no mask): 11987654321
  const phone = h("input", { id: "l-phone", type: "tel", inputMode: "numeric", autocomplete: "tel-national",
    placeholder: "11987654321", maxLength: 11, required: true,
    title: "DDD + número, só os dígitos (10 ou 11)" });
  const password = h("input", { id: "l-password", type: "password", required: true,
    autocomplete: challenge ? "new-password" : "current-password" });
  const passwordField = revealable(password);
  const button = h("button", { className: "primary", type: "submit" }, challenge ? "Definir senha" : "Entrar");
  const form = h("form", { className: "card login" },
    h("h1", {}, "Minhas Casas"),
    challenge && h("p", { className: "muted" }, "Primeiro acesso: escolha a sua senha (10+ caracteres, com maiúscula, minúscula e número)."),
    !challenge && [h("label", { htmlFor: "l-phone" }, "Celular (DDD + número)"), phone],
    h("label", { htmlFor: "l-password" }, challenge ? "Nova senha" : "Senha"), passwordField,
    h("div", { className: "actions" }, button));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    whileDisabled(button, async () => {
      try {
        if (challenge) { await setNewPassword(challenge, password.value); return start(); }
        const r = await signIn(phone.value.trim(), password.value);
        if (r.challenge) return loginScreen(r.challenge);
        start();
      } catch (error) { notify(error.message, true); }
    });
  });
  render(content, form);
  (challenge ? password : phone).focus();
}

function start() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("backdrop");
  const toggle = document.getElementById("menu-toggle");
  document.getElementById("top-bar").hidden = sidebar.hidden = false;
  document.body.classList.add("signed-in");

  // On phones the sidebar is a drawer: ☰ opens it; choosing a page, the backdrop or Esc closes it.
  const setDrawer = (open) => {
    sidebar.classList.toggle("open", open);
    backdrop.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
  };
  toggle.onclick = () => setDrawer(!sidebar.classList.contains("open"));
  backdrop.onclick = () => setDrawer(false);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebar.classList.contains("open")) { setDrawer(false); toggle.focus(); }
  });

  // the pages: the ones in the menu, then the Configurações group at its bottom (Perfil, Predefinições)
  const groupButtons = [document.getElementById("open-profile"), document.getElementById("open-defaults")];
  const pages = [...SCREENS, ["Perfil", mountProfile], ["Predefinições", mountDefaults]];
  const buttons = [...SCREENS.map(([name], i) => h("button", { onclick: () => open(i) }, name)), ...groupButtons];
  groupButtons.forEach((button, i) => { button.onclick = () => open(SCREENS.length + i); });
  const open = (index) => {
    buttons.forEach((b, i) => (i === index ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    setDrawer(false);
    const area = h("div");
    render(content, area);
    pages[index][1](area);
  };
  render(document.getElementById("menu"), buttons.slice(0, SCREENS.length));

  const logout = document.getElementById("logout");
  if (CONFIG.skipLogin) {                        // local server: there is nobody to log out
    logout.replaceWith(h("span", { id: "local-mode", className: "muted" }, "Modo local, sem login"));
  } else logout.onclick = () => { signOut(); location.reload(); };
  open(0);
}

if (!CONFIG.apiUrl || (!CONFIG.clientId && !CONFIG.skipLogin)) {
  render(content, h("p", { className: "notice" }, "Sistema ainda não configurado (js/config.js vazio)."));
} else if (isSignedIn()) start();
else loginScreen();
