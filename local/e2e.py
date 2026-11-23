"""Opens the frontend in a real Chromium, talking to the real API (in-memory database).
Run:  python local/e2e.py

Two passes: `run()` goes through the login screen with a simulated Cognito (like the deployed app) and
then registers a house and its renovation costs; `run_without_login()` checks the local server's
default mode, which has no login and opens with the demo data.

The texts used in the selectors ("Entrar", "Salvar", ...) are the app's labels, which are in Portuguese."""
import json
import re
import struct
import threading
import zlib

from playwright.sync_api import expect, sync_playwright

import server as local_server


def url_of(server):
    """Each test's server listens on a free port the system picked (start(0)): it never collides with a
    `python dev.py serve` that is running."""
    return f"http://127.0.0.1:{server.server_address[1]}/"


def cognito(route):
    """First access requires a new password, like a user created by the administrator. The token is
    "token-u<DDD + number>-<name>": the local server takes the login, its phone and its name from it
    (local/server.py)."""
    target = route.request.headers["x-amz-target"].split(".")[-1]
    body = json.loads(route.request.post_data)
    username = (body.get("AuthParameters") or body.get("ChallengeResponses") or {}).get("USERNAME")
    if username is not None:
        assert re.fullmatch(r"\+55\d{10,11}", username), username      # DDD + number becomes +55...
    if target == "ChangePassword":                                  # Configurações: the current one must be right
        assert body["AccessToken"].startswith("access-"), body
        if body["PreviousPassword"] != "Another-Password-9":
            return route.fulfill(status=400, content_type="application/x-amz-json-1.1",
                                 body=json.dumps({"__type": "NotAuthorizedException"}))
        return route.fulfill(status=200, content_type="application/x-amz-json-1.1", body="{}")
    if target == "InitiateAuth" and body["AuthParameters"].get("PASSWORD") == "wrong":
        return route.fulfill(status=400, content_type="application/x-amz-json-1.1",
                             body=json.dumps({"__type": "NotAuthorizedException"}))
    if target == "InitiateAuth":
        response = {"ChallengeName": "NEW_PASSWORD_REQUIRED", "Session": "session-1"}
    else:
        token = f"token-u{username[3:]}-{NAMES[username[3:]]}"
        response = {"AuthenticationResult": {"IdToken": token, "AccessToken": f"access-{username[3:]}",
                                             "ExpiresIn": 3600, "RefreshToken": "r"}}
    route.fulfill(status=200, content_type="application/x-amz-json-1.1", body=json.dumps(response))


NAMES = {"11987654321": "Ana Lima", "21922222222": "Bruno Reis"}     # the logins' names (Cognito's `name`)


def log_in(page, phone):
    """First access of `phone` (DDD + number): password, then the new password."""
    page.fill("#l-phone", phone)
    page.fill("#l-password", "Strong-Password-1")
    page.click("text=Entrar")
    expect(page.locator("text=Primeiro acesso")).to_be_visible()
    page.fill("#l-password", "Another-Password-9")
    page.click("text=Definir senha")
    expect(page.locator("h1", has_text="Casas")).to_be_visible()


def png(red, green, blue, size=40):
    """A small solid-color PNG, to send as a photo."""
    row = bytes([0]) + bytes([red, green, blue]) * size          # each row: no filter, then the pixels
    chunk = lambda kind, data: (struct.pack(">I", len(data)) + kind + data  # noqa: E731
                                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
    return (bytes.fromhex("89504e470d0a1a0a") + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(row * size)) + chunk(b"IEND", b""))


def photo(name, color):
    return {"name": name, "mimeType": "image/png", "buffer": png(*color)}


def watch(page, errors):
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("dialog", lambda d: d.accept())                 # confirm() before deleting


def run():
    server = local_server.start(0, require_login=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        watch(page, errors)
        page.route("https://cognito-idp.sa-east-1.amazonaws.com/", cognito)
        page.goto(url_of(server))

        # login: wrong password, then first access with a new password
        page.fill("#l-phone", "119876543")             # too short: caught on the screen
        page.fill("#l-password", "wrong")
        page.click("text=Entrar")
        expect(page.locator(".toast.error")).to_contain_text("Celular inválido")
        page.fill("#l-phone", "11987654321")
        page.fill("#l-password", "wrong")
        page.click("text=Entrar")
        expect(page.locator(".toast.error").last).to_contain_text("incorretos")
        page.fill("#l-password", "Strong-Password-1")
        page.click("text=Entrar")
        expect(page.locator("text=Primeiro acesso")).to_be_visible()
        page.fill("#l-password", "Another-Password-9")
        expect(page.locator("#l-password")).to_have_attribute("type", "password")
        page.click("[aria-label='Mostrar senha']")                  # the eye shows what was typed
        expect(page.locator("#l-password")).to_have_attribute("type", "text")
        page.click("[aria-label='Ocultar senha']")
        expect(page.locator("#l-password")).to_have_attribute("type", "password")
        page.click("text=Definir senha")
        expect(page.locator(".empty-state")).to_contain_text("Nenhuma casa ainda")
        errors.clear()                  # the browser logged Cognito's 400 for the wrong password, on purpose

        # a new house: an invalid amount is caught on the screen, then it is saved and its page opens
        page.locator(".empty-state button", has_text="Nova casa").click()
        expect(page.locator("dialog")).to_have_count(0)                                # a page, not a modal
        expect(page.locator(".stepper button")).to_have_count(0)                       # a new house: item by item
        expect(page.locator("h1")).to_have_text("Nova casa")
        page.click("#h-next")
        expect(page.locator(".toast.error").last).to_contain_text("Nome")              # one step at a time
        page.fill("#h-name", "Casa Azul")
        page.fill("#h-address", "Rua das Flores, 10")
        page.fill("#h-date", "15/01/2026")                                    # Brazilian format
        page.click("#h-next")
        page.locator("#h-areas .chip", has_text="Cozinha").click()                      # areas: two suggestions
        page.locator("#h-areas .chip", has_text="Banheiros").click()
        page.fill("#h-other-area", "Edícula")                                          # and one typed in
        page.keyboard.press("Enter")
        expect(page.locator("#h-areas .chip:has(input:checked)")).to_have_count(3)
        page.click("#h-next")
        page.fill("#h-price", "abc")
        page.click("#h-next")
        expect(page.locator(".toast.error").last).to_contain_text("Valor do imóvel")
        page.fill("#h-price", "300.000,00")
        page.fill("#h-costs", "18.000")
        page.fill("#h-profit", "30")
        page.click("#h-next")                                                          # one house: straight to the payment
        expect(page.locator("#h-down")).to_be_hidden()                                 # à vista: no entrada
        page.locator("label.choice", has_text="Parcelado").click()
        page.fill("#h-down", "60.000")
        page.fill("#h-count", "3")
        page.fill("#h-amount", "80.000")
        expect(page.locator("#h-first")).to_have_value("15/02/2026")                   # a month after the purchase
        expect(page.locator("#h-summary")).to_contain_text("3 × R$ 80.000,00 = R$ 300.000,00")
        calls = []
        page.on("request", lambda r: "/houses" in r.url and calls.append(f"{r.method} {r.url.split('/houses', 1)[1]}"))
        page.click("#h-save")
        expect(page.locator("h1")).to_contain_text("Casa Azul")
        expect(page.locator("#house-totals")).to_contain_text("318.000,00")
        assert calls == ["POST "], f"saving a house takes one request, not {calls}"   # the answer is the page

        # the page is in tabs: Reforma is open; Compra has the purchase's data
        expect(page.locator("[role=tab]")).to_have_text(["Reforma", "Compra", "Prestações (0/3)", "Sócios", "Timeline"])
        expect(page.locator("#tab-renovation")).to_have_attribute("aria-selected", "true")
        expect(page.locator("#areas")).to_be_visible()
        expect(page.locator("#purchase")).to_be_hidden()
        page.click("#tab-purchase")
        expect(page.locator("#purchase")).to_be_visible()
        expect(page.locator("#areas")).to_be_hidden()
        expect(page.locator("#purchase")).to_contain_text("Parcelado")
        expect(page.locator("#purchase")).to_contain_text("60.000,00")                 # entrada
        expect(page.locator("#purchase")).to_contain_text("240.000,00")                # the rest, in installments
        expect(page.locator("#sale")).to_contain_text("lucrar 30 %")
        expect(page.locator("#sale .sale-price")).to_have_text("R$ 413.400,00")       # 318.000 + 30%

        # installments: the three registered with the house; the first is paid, the last deleted
        page.keyboard.press("ArrowRight")                                              # Compra -> Prestações
        expect(page.locator("#tab-installments")).to_be_focused()
        expect(page.locator("#installments")).to_be_visible()
        expect(page.locator("#installments tbody tr")).to_have_count(3)
        expect(page.locator("#installments tbody")).to_contain_text("15/04/2026")
        expect(page.locator("#installments .totals")).to_contain_text("0 de 3")
        page.locator("#installments tbody tr").first.locator(".kebab").click()
        page.locator(".menu-list:not([hidden]) [role=menuitem]", has_text="Marcar como paga").click()
        expect(page.locator("#installments .totals")).to_contain_text("1 de 3")
        expect(page.locator("#installments .totals")).to_contain_text("140.000,00")    # entrada + the paid one
        expect(page.locator("#installments tbody tr").first.locator(".badge")).to_have_text("Paga")
        page.locator("#installments tbody tr").last.locator(".kebab").click()
        page.locator(".menu-list:not([hidden]) [role=menuitem]", has_text="Excluir").click()
        expect(page.locator("#installments tbody tr")).to_have_count(2)
        expect(page.locator("#installments .totals")).to_contain_text("1 de 2")
        expect(page.locator("#installments")).to_be_visible()                          # the tab stays open after a change
        expect(page.locator("#tab-installments")).to_have_text("Prestações (1/2)")

        # two renovation costs, each in an area, then one is changed and the other deleted
        page.click("#tab-renovation")
        expect(page.locator("#areas")).to_contain_text("Ainda sem custos: Cozinha, Banheiros, Edícula")
        for description, category, area, amount in (("Cimento e areia", "material", "Cozinha", "1.500,50"),
                                                    ("Pedreiro", "labor", "Banheiros", "4.000")):
            page.click("text=Novo custo")
            page.fill("#e-description", description)
            page.select_option("#e-category", category)
            page.select_option("#e-area", label=area)
            page.fill("#e-amount", amount)
            if description == "Pedreiro":                     # a photo of the NF (reduced to a JPEG and sent)
                page.set_input_files("#e-nf", photo("nf.png", (200, 200, 200)))
                expect(page.locator(".photo-field img").first).to_be_visible()     # its preview
            page.click("dialog >> text=Salvar")
            expect(page.locator("#expenses tbody")).to_contain_text(description)
        expect(page.locator("#house-totals")).to_contain_text("5.500,50")       # renovation
        expect(page.locator("#house-totals")).to_contain_text("323.500,50")     # total
        expect(page.locator("#sale .sale-price")).to_have_text("R$ 420.550,65")       # goes up with the renovation
        expect(page.locator(".bars").last).to_contain_text("Mão de obra")
        expect(page.locator("#areas li").first).to_contain_text("Banheiros")           # the most expensive first
        expect(page.locator("#areas li").first).to_contain_text("mais cara")
        expect(page.locator("#areas li").first).to_contain_text("4.000,00")
        expect(page.locator("#areas")).to_contain_text("Ainda sem custos: Edícula")
        expect(page.locator("#expenses tbody tr", has_text="Pedreiro")).to_contain_text("Banheiros")

        row = page.locator("#expenses tbody tr", has_text="Pedreiro")
        row.locator(".kebab").click()
        page.locator(".menu-list:not([hidden]) [role=menuitem]", has_text="Editar").click()
        expect(page.locator("#e-amount")).to_have_value("4.000,00")
        page.fill("#e-amount", "3.000")
        page.click("dialog >> text=Salvar")
        expect(page.locator("#house-totals")).to_contain_text("4.500,50")
        row = page.locator("#expenses tbody tr", has_text="Cimento")
        row.locator(".kebab").click()
        page.locator(".menu-list:not([hidden]) [role=menuitem]", has_text="Excluir").click()
        expect(page.locator("#expenses tbody tr")).to_have_count(1)
        expect(page.locator("#house-totals")).to_contain_text("3.000,00")

        # the NF photo: seen big
        row = page.locator("#expenses tbody tr", has_text="Pedreiro")
        row.locator("text=Ver NF").click()
        expect(page.locator("dialog img.photo-big")).to_be_visible()
        assert page.locator("dialog img.photo-big").evaluate("img => img.naturalWidth") == 40   # it loads
        page.click("dialog >> text=Fechar")

        # the timeline: a moment with two photos; then one of them is taken out
        page.click("#tab-timeline")
        expect(page.locator("#timeline")).to_contain_text("Registre aqui a evolução da casa")
        page.click("text=Adicionar fotos")
        page.fill("#t-caption", "Dia da compra")
        page.set_input_files("#t-files", [photo("a.png", (180, 60, 60)), photo("b.png", (60, 60, 180))])
        expect(page.locator("#t-photos img")).to_have_count(2)
        page.click("dialog >> text=Salvar")
        expect(page.locator("#timeline .moment")).to_have_count(1)
        expect(page.locator("#timeline .moment")).to_contain_text("Dia da compra")
        expect(page.locator("#timeline .moment img")).to_have_count(2)
        expect(page.locator("#tab-timeline")).to_have_text("Timeline (1)")
        page.locator("#timeline .moment .kebab").click()
        page.locator(".menu-list:not([hidden]) [role=menuitem]", has_text="Editar").click()
        expect(page.locator("#t-photos img")).to_have_count(2)
        page.locator("#t-photos .thumb-remove").first.click()
        page.click("dialog >> text=Salvar")
        expect(page.locator("#timeline .moment img")).to_have_count(1)
        page.click("#tab-renovation")

        # editing the house keeps its costs; the list shows its totals
        page.click("text=Editar casa")
        expect(page.locator("#h-name")).to_have_value("Casa Azul")
        expect(page.locator(".stepper li")).to_have_text(["Dados", "Reforma", "Valor", "Pagamento"])
        page.click(".stepper >> text=Pagamento")                                       # jump, no step by step
        expect(page.locator("#h-down")).to_have_value("60.000,00")
        page.click(".stepper >> text=Valor")
        expect(page.locator("#h-price")).to_have_value("300.000,00")
        expect(page.locator(".stepper li")).to_have_text(["Dados", "Reforma", "Valor", "Pagamento"])   # none disappears
        page.click(".stepper >> text=Dados")
        page.select_option("#h-status", "ready")
        page.click("#h-next")
        expect(page.locator("#h-areas .chip:has(input:checked)")).to_have_text(["Cozinha", "Banheiros", "Edícula"])
        page.locator("#h-areas .chip", has_text="Banheiros").click()                    # an area with a cost...
        page.click("#h-next")
        expect(page.locator("#h-price")).to_have_value("300.000,00")
        expect(page.locator("#h-profit")).to_have_value("30")
        page.click("#h-next")
        expect(page.locator("#h-down")).to_have_value("60.000,00")
        expect(page.locator("#h-count")).to_have_count(0)                              # the plan: on the house page
        page.click("#h-save")
        expect(page.locator(".toast.error").last).to_contain_text("tem custos lançados")   # ...is not removed
        errors[:] = [e for e in errors if "status of 400" not in e]                  # that 400 was on purpose
        page.click("text=Voltar")
        page.click("text=Voltar")
        page.locator("#h-areas .chip", has_text="Banheiros").click()
        page.click("#h-next")
        page.click("#h-next")
        page.click("#h-save")
        expect(page.locator("h1 .badge")).to_have_text("Pronta")
        page.click("text=‹ Casas")
        expect(page.locator(".list-item")).to_have_count(1)
        expect(page.locator("#portfolio")).to_contain_text("321.000,00")
        expect(page.locator(".list-item")).to_contain_text("vender por R$ 417.300,00")           # 321.000 + 30%

        # a partner: invited by phone, accepts on their own login and pays a cost; the owner sees who put in what
        page.locator(".list-item", has_text="Casa Azul").click()
        page.click("#tab-partners")
        expect(page.locator("#partners")).to_contain_text("Nenhum sócio")
        page.fill("#p-phone", "21922222222")
        page.click("#partners button[type=submit]")
        expect(page.locator("#partners .members")).to_contain_text("(21) 92222-2222")
        expect(page.locator("#partners .members")).to_contain_text("aguardando")
        partner = browser.new_page()                                # another browser: another login
        watch(partner, errors)
        partner.route("https://cognito-idp.sa-east-1.amazonaws.com/", cognito)
        partner.goto(url_of(server))
        log_in(partner, "21922222222")
        expect(partner.locator(".card.invite")).to_contain_text("Ana Lima ((11) 98765-4321) convidou você")
        expect(partner.locator(".card.invite")).to_contain_text("Casa Azul")
        partner.click(".card.invite >> text=Aceitar")
        expect(partner.locator(".card.invite")).to_have_count(0)                        # accepted: in the list, not opened
        partner.locator(".list-item", has_text="Casa Azul").click()
        expect(partner.locator("h1")).to_contain_text("Casa Azul")
        expect(partner.locator("button.danger:has-text('Excluir')")).to_have_count(1)    # partners are all equal
        expect(partner.locator("text=dono")).to_have_count(0)
        partner.click("text=Novo custo")
        partner.fill("#e-description", "Azulejos")
        partner.fill("#e-amount", "2.000")
        expect(partner.locator("#e-paid-by option:checked")).to_have_text("Você")      # paid by whoever registers it
        partner.click("dialog >> text=Salvar")
        expect(partner.locator("#expenses tbody tr", has_text="Azulejos")).to_contain_text("pago por Você")

        page.click("text=‹ Casas")
        expect(page.locator(".list-item .badge.partner")).to_have_text("Com sócios")
        page.locator(".list-item", has_text="Casa Azul").click()
        expect(page.locator("#tab-partners")).to_have_text("Sócios (2)")              # the tab stayed open
        rows = page.locator("#by-member tbody tr")
        expect(rows).to_have_count(2)
        expect(rows.nth(0)).to_contain_text("Você")
        expect(rows.nth(0)).to_contain_text("161.000,00")      # entrada + costs 78.000, installment 80.000, cost 3.000
        expect(rows.nth(1)).to_contain_text("Bruno Reis")                                # by name
        expect(page.locator("#partners .members li").nth(1)).to_contain_text("Bruno Reis")
        expect(page.locator("#partners .members li").nth(1)).to_contain_text("(21) 92222-2222")
        expect(page.locator("#partners")).not_to_contain_text("Total pago")       # the totals: in their own card
        expect(page.locator("#investment")).to_contain_text("Investimento por sócio")
        expect(rows.nth(1)).to_contain_text("2.000,00")
        expect(page.locator("text=Dividir a compra")).to_have_count(0)  # the purchase is only split when registering

        # deleting the house: it is gone for the partner too
        page.click("button.danger:has-text('Excluir')")
        expect(page.locator(".empty-state")).to_be_visible()
        partner.click("text=‹ Casas")
        expect(partner.locator(".empty-state")).to_be_visible()

        # Configurações: the name partners see, the default profit (a new house starts with it), the password
        page.click("#open-profile")                                   # the Configurações group, bottom of the menu
        expect(page.locator("#open-profile")).to_have_attribute("aria-current", "page")
        expect(page.locator("h1")).to_have_text("Perfil")
        expect(page.locator("#s-name")).to_have_value("Ana Lima")                     # the login's name
        expect(page.locator("#settings-data")).to_contain_text("(11) 98765-4321")
        page.fill("#s-name", "Ana L. Souza")
        page.click("#settings-data button[type=submit]")
        expect(page.locator(".toast").last).to_contain_text("Dados salvos")
        page.click("#open-defaults")
        expect(page.locator("h1")).to_have_text("Predefinições")
        page.fill("#s-profit", "25")
        page.click("#settings-defaults button[type=submit]")
        expect(page.locator(".toast").last).to_contain_text("Predefinições salvas")
        page.click("#open-profile")
        expect(page.locator("#s-name")).to_have_value("Ana L. Souza")                 # saving one kept the other
        page.click("#change-password")                                                # Perfil > Segurança
        page.fill("#p-current", "Wrong-Password-1")
        page.fill("#p-new", "Third-Password-7")
        page.fill("#p-again", "Third-Password-7")
        page.click("#password-form button[type=submit]")
        expect(page.locator(".toast.error").last).to_contain_text("Senha atual incorreta")
        errors[:] = [e for e in errors if "status of 400" not in e]                  # that 400 was on purpose
        page.fill("#p-current", "Another-Password-9")
        page.click("#password-form button[type=submit]")
        expect(page.locator(".toast").last).to_contain_text("Senha trocada")
        expect(page.locator("#password-form")).to_have_count(0)                      # the form closed
        page.click("nav >> text=Casas")

        # a house bought with a partner: the split is set when registering it, and the partner is invited
        page.locator(".empty-state button", has_text="Nova casa").click()
        page.fill("#h-name", "Casa Verde")
        page.fill("#h-address", "Rua B, 2")
        page.click("#h-next")
        page.click("#h-next")
        expect(page.locator("#h-profit")).to_have_value("25")                       # the default profit
        page.fill("#h-price", "200.000")
        page.fill("#h-costs", "10.000")
        page.click("#h-next")
        expect(page.locator("#h-owner-share")).to_be_hidden()                          # "Só eu" by default
        page.locator("label.choice", has_text="Com sócios").click()
        page.fill("#h-owner-share", "100.000")
        page.locator("#h-partners .p-phone").fill("21922222222")
        page.locator("#h-partners .p-cents").fill("100.000")
        expect(page.locator("#h-split")).to_contain_text("faltam R$ 10.000,00")
        page.click("#h-save")
        expect(page.locator(".toast.error").last).to_contain_text("precisa fechar")    # the split must add up
        errors[:] = [e for e in errors if "status of 400" not in e]                  # that 400 was on purpose
        page.fill("#h-owner-share", "110.000")
        expect(page.locator("#h-split")).to_contain_text("a divisão fecha")
        page.click("#h-save")
        expect(page.locator("h1")).to_contain_text("Casa Verde")
        page.click("#tab-partners")
        expect(page.locator("#partners .members")).to_contain_text("aguardando")
        expect(page.locator("#by-member tbody tr").nth(1)).to_contain_text("100.000,00")   # theirs before accepting
        partner.reload()
        partner.click(".card.invite >> text=Aceitar")
        expect(partner.locator("h1")).to_contain_text("Casas (1)")                         # not opened: it is in the list
        expect(partner.locator(".card.invite")).to_have_count(0)
        partner.locator(".list-item", has_text="Casa Verde").click()                   # and opens when they want
        expect(partner.locator("h1")).to_contain_text("Casa Verde")
        partner.click("#tab-partners")
        expect(partner.locator("#partners .members li").first).to_contain_text("Ana L. Souza")   # the name chosen
        expect(partner.locator("#by-member tbody tr").nth(1)).to_contain_text("Você")
        expect(partner.locator("#by-member tbody tr").nth(1)).to_contain_text("100.000,00")

        # two houses bought at once: each one asks for all its data, then one payment for both
        page.click("nav >> text=Casas")
        page.locator("button", has_text="Nova casa").first.click()
        page.fill("#h-name", "Casa Dupla A")
        page.fill("#h-address", "Rua C, 3")
        page.click("#h-next")
        page.click("#h-next")
        page.fill("#h-price", "500.000")
        page.click("#h-add-here")                                                      # bought another one in the same deal
        page.fill("#h-name", "Casa Dupla B")
        page.fill("#h-address", "Rua C, 4")
        expect(page.locator("#h-date")).to_have_count(0)                               # the deal's date is the first one's
        page.click("#h-next")
        page.click("#h-next")
        page.fill("#h-price", "250.000")
        page.click("#h-next")
        expect(page.locator("#h-houses li")).to_have_count(2)
        page.click("#h-next")
        page.locator("label.choice", has_text="Parcelado").click()
        page.fill("#h-down", "75.000")
        page.fill("#h-count", "2")
        page.fill("#h-amount", "10.000")
        expect(page.locator("#h-bundle-note")).to_contain_text("Casa Dupla A 66,67 %")
        expect(page.locator("#h-bundle-note")).to_contain_text("Casa Dupla B 33,33 %")
        page.locator("label.choice", has_text="Com sócios").click()                    # partners paid part of the entrada too
        page.fill("#h-owner-share", "25.000")
        page.locator("#h-partners .p-phone").fill("21933333333")
        page.locator("#h-partners .p-cents").fill("40.000")
        expect(page.locator("#h-split")).to_contain_text("faltam R$ 10.000,00")
        page.locator("#h-partners .p-cents").fill("50.000")
        expect(page.locator("#h-split")).to_contain_text("a divisão fecha")
        page.click("#h-save")
        expect(page.locator("h1")).to_contain_text("Casa Dupla A")
        page.click("#tab-partners")
        expect(page.locator("#partners .members")).to_contain_text("aguardando")
        page.click("#tab-installments")
        page.click("#tab-installments")
        expect(page.locator("#bundle-note")).to_contain_text("Compra conjunta")
        expect(page.locator("#installments-table tbody tr")).to_have_count(2)
        expect(page.locator("#installments-table tbody tr").first).to_contain_text("10.000,00")   # the whole installment
        expect(page.locator("#installments-table tbody tr").first).to_contain_text("6.666,67")    # this house's part
        browser.close()
    server.shutdown()
    assert not errors, errors
    print("e2e with login: ok")


def run_without_login():
    server = local_server.start(0, demo_data=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 390, "height": 844})          # a phone
        watch(page, errors)
        page.goto(url_of(server))
        expect(page.locator("#local-mode")).to_have_count(1)
        expect(page.locator(".list-item")).to_have_count(3)                            # the sold one is hidden
        expect(page.locator("#toggle-sold")).to_have_text("Mostrar vendidas (1)")
        page.click("#toggle-sold")
        expect(page.locator(".list-item")).to_have_count(4)
        expect(page.locator(".list-item").last).to_contain_text("Casa da Rua das Flores")    # the sold one: last
        page.click("#toggle-sold")
        expect(page.locator(".list-item")).to_have_count(3)
        page.locator(".list-item", has_text="Sobrado Vila Nova").click()
        expect(page.locator(".bars").last.locator("li")).to_have_count(4)               # categories
        expect(page.locator("#areas li")).to_have_count(3)                              # Telhado, Hidráulica, Sem área
        expect(page.locator("#areas li").first).to_contain_text("Telhado")
        expect(page.locator("#areas")).to_contain_text("Ainda sem custos: Banheiros, Cozinha")
        expect(page.locator("#expenses tbody tr")).to_have_count(7)
        expect(page.locator("#expenses tbody")).to_contain_text("pago por Marcos Pereira")    # bought with a partner
        page.click("#tab-installments")
        expect(page.locator("#installments tbody tr")).to_have_count(10)               # a page of a long plan
        expect(page.locator("#installments .pager-page")).to_contain_text("de 12")
        page.click("#tab-partners")
        expect(page.locator("#by-member tbody tr")).to_have_count(2)
        expect(page.locator("#by-member tbody tr").nth(1)).to_contain_text("93.600,00")   # half of the purchase
        page.click("#tab-timeline")
        expect(page.locator("#timeline .moment")).to_have_count(4)                     # from the purchase on
        expect(page.locator("#timeline .moment").first).to_contain_text("Dia da compra")
        page.click("#tab-renovation")
        expect(page.locator("#expenses tbody tr", has_text="Madeiramento")).to_contain_text("Ver NF")
        width = page.evaluate("document.documentElement.scrollWidth")
        assert width <= 390, f"the page scrolls sideways on a phone ({width}px)"
        for tab in ("renovation", "purchase", "installments", "partners", "timeline"):     # every tab in sight
            box = page.locator(f"#tab-{tab}").bounding_box()
            assert box["x"] >= 0 and box["x"] + box["width"] <= 390, f"tab {tab} off the screen on a phone"
        page.click("#tab-renovation")
        amount = page.locator("#expenses tbody tr").first.locator("td.num").bounding_box()
        assert amount["x"] + amount["width"] <= 390, "a cost's amount off the screen on a phone"

        # local mode: Alterar senha explains there is no password without a login
        page.click("#menu-toggle")
        page.click("#open-profile")
        page.click("#change-password")
        expect(page.locator("#password-form")).to_contain_text("No modo local não há login")
        expect(page.locator("#password-form button[type=submit]")).to_be_disabled()
        page.click("#password-form >> text=Fechar")
        page.click("#menu-toggle")
        page.click("nav >> text=Casas")

        # every list pages at 10: the 12 costs of a house in two pages
        page.click("#toggle-sold")                                                     # it is a sold house
        page.locator(".list-item", has_text="Casa da Rua das Flores").click()
        page.click("#tab-renovation")
        expect(page.locator("#expenses tbody tr")).to_have_count(10)
        expect(page.locator("#panel-renovation .pager")).to_contain_text("1–10 de 12")
        page.click("#panel-renovation [aria-label='Próxima página']")
        expect(page.locator("#expenses tbody tr")).to_have_count(2)

        # an invite waiting on top of the list: accepting it adds the house to the list, without opening it
        page.click("text=‹ Casas")
        expect(page.locator(".card.invite")).to_contain_text("Marcos Pereira ((11) 98888-7777) convidou você")
        page.click(".card.invite >> text=Aceitar")
        expect(page.locator(".card.invite")).to_have_count(0)
        page.locator(".list-item", has_text="Casa Vila Rica").click()
        expect(page.locator("h1")).to_contain_text("Casa Vila Rica")
        page.click("#tab-partners")
        expect(page.locator("#p-phone")).to_have_count(1)                              # a partner invites too
        expect(page.locator("#partners")).not_to_contain_text("dono")
        page.click("text=‹ Casas")
        expect(page.locator(".card.invite")).to_have_count(0)
        expect(page.locator(".list-item")).to_have_count(5)                            # sold ones still shown
        browser.close()
    server.shutdown()
    assert not errors, errors
    print("e2e without login: ok")


if __name__ == "__main__":
    run()
    run_without_login()
