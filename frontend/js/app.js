import { CONFIG } from "./config.js";
import { isSignedIn, setNewPassword, signIn, signOut } from "./auth.js";
import { h, notify, render, whileDisabled } from "./util.js";
import { mount as houses } from "./screens/houses.js";

const content = document.getElementById("content");
const SCREENS = [["Casas", houses]];             // [name in the menu, mount]

const SVG = "http://www.w3.org/2000/svg";
const EYE = "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z";
const EYE_OFF = "M3 3l18 18 M10.6 5.1A10.7 10.7 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 4.1 M6.6 6.6A18 18 0 0 0 1 12s4 7 11 7a10.6 10.6 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2";

/** A password input with an eye button that shows / hides what was typed. */
function revealable(input) {
  const path = document.createElementNS(SVG, "path");
  const icon = document.createElementNS(SVG, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.append(path);
  const toggle = h("button", { type: "button", className: "reveal", onclick: () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    update();
    input.focus();
  } }, icon);
  function update() {
    const shown = input.type === "text";
    path.setAttribute("d", shown ? EYE_OFF : EYE);
    toggle.setAttribute("aria-label", shown ? "Ocultar senha" : "Mostrar senha");
    toggle.title = shown ? "Ocultar senha" : "Mostrar senha";
    toggle.setAttribute("aria-pressed", String(shown));
  }
  update();
  return h("div", { className: "password-field" }, input, toggle);
}

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

  const buttons = SCREENS.map(([name], i) => h("button", { onclick: () => open(i) }, name));
  const open = (index) => {
    buttons.forEach((b, i) => (i === index ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    setDrawer(false);
    const area = h("div");
    render(content, area);
    SCREENS[index][1](area);
  };
  render(document.getElementById("menu"), buttons);

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
