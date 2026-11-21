"""Opens the frontend in a real Chromium, talking to the real API (in-memory database).
Run:  python local/e2e.py

Two passes: `run()` goes through the login screen with a simulated Cognito (like the deployed app) and
then registers a house and its renovation costs; `run_without_login()` checks the local server's
default mode, which has no login and opens with the demo data.

The texts used in the selectors ("Entrar", "Salvar", ...) are the app's labels, which are in Portuguese."""
import json
import threading

from playwright.sync_api import expect, sync_playwright

import server as local_server


def url_of(server):
    """Each test's server listens on a free port the system picked (start(0)): it never collides with a
    `python dev.py serve` that is running."""
    return f"http://127.0.0.1:{server.server_address[1]}/"


def cognito(route):
    """First access requires a new password, like a user created by the administrator."""
    target = route.request.headers["x-amz-target"].split(".")[-1]
    body = json.loads(route.request.post_data)
    if target == "InitiateAuth" and "USERNAME" in body["AuthParameters"]:
        assert body["AuthParameters"]["USERNAME"] == "+5511987654321"   # DDD + number becomes +55...
    if target == "RespondToAuthChallenge":
        assert body["ChallengeResponses"]["USERNAME"] == "+5511987654321"
    if target == "InitiateAuth" and body["AuthParameters"].get("PASSWORD") == "wrong":
        return route.fulfill(status=400, content_type="application/x-amz-json-1.1",
                             body=json.dumps({"__type": "NotAuthorizedException"}))
    if target == "InitiateAuth":
        response = {"ChallengeName": "NEW_PASSWORD_REQUIRED", "Session": "session-1"}
    else:
        response = {"AuthenticationResult": {"IdToken": "token-user-1", "ExpiresIn": 3600, "RefreshToken": "r"}}
    route.fulfill(status=200, content_type="application/x-amz-json-1.1", body=json.dumps(response))


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
        page.fill("#h-name", "Casa Azul")
        page.fill("#h-address", "Rua das Flores, 10")
        page.fill("#h-date", "2026-01-15")
        page.fill("#h-price", "abc")
        page.click("dialog >> text=Salvar")
        expect(page.locator(".toast.error").last).to_contain_text("Valor do imóvel")
        page.fill("#h-price", "300.000,00")
        page.fill("#h-costs", "18.000")
        expect(page.locator("#h-down")).to_be_hidden()                                 # à vista: no entrada
        page.locator("label.choice", has_text="Parcelado").click()
        page.fill("#h-down", "60.000")
        page.fill("#h-count", "3")
        page.fill("#h-amount", "80.000")
        expect(page.locator("#h-first")).to_have_value("2026-02-15")                   # a month after the purchase
        expect(page.locator("#h-summary")).to_contain_text("3 × R$ 80.000,00 = R$ 300.000,00")
        page.fill("#h-profit", "30")
        page.locator("#h-areas .chip", has_text="Cozinha").click()                      # areas: two suggestions
        page.locator("#h-areas .chip", has_text="Banheiros").click()
        page.fill("#h-other-area", "Edícula")                                          # and one typed in
        page.keyboard.press("Enter")
        expect(page.locator("#h-areas .chip:has(input:checked)")).to_have_count(3)
        calls = []
        page.on("request", lambda r: "/houses" in r.url and calls.append(f"{r.method} {r.url.split('/houses', 1)[1]}"))
        page.click("dialog >> text=Salvar")
        expect(page.locator("h1")).to_contain_text("Casa Azul")
        expect(page.locator("#house-totals")).to_contain_text("318.000,00")
        assert calls == ["POST "], f"saving a house takes one request, not {calls}"   # the answer is the page
        expect(page.locator("#purchase")).to_contain_text("Parcelado")
        expect(page.locator("#purchase")).to_contain_text("60.000,00")                 # entrada
        expect(page.locator("#purchase")).to_contain_text("240.000,00")                # the rest, in installments
        expect(page.locator("#sale")).to_contain_text("lucrar 30 %")
        expect(page.locator("#sale .sale-price")).to_have_text("R$ 413.400,00")       # 318.000 + 30%

        # installments: the three registered with the house; the first is paid, the last deleted
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

        # two renovation costs, each in an area, then one is changed and the other deleted
        expect(page.locator("#areas")).to_contain_text("Ainda sem custos: Cozinha, Banheiros, Edícula")
        for description, category, area, amount in (("Cimento e areia", "material", "Cozinha", "1.500,50"),
                                                    ("Pedreiro", "labor", "Banheiros", "4.000")):
            page.click("text=Novo custo")
            page.fill("#e-description", description)
            page.select_option("#e-category", category)
            page.select_option("#e-area", label=area)
            page.fill("#e-amount", amount)
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

        # editing the house keeps its costs; the list shows its totals
        page.click("text=Editar casa")
        expect(page.locator("#h-price")).to_have_value("300.000,00")
        expect(page.locator("#h-down")).to_have_value("60.000,00")
        expect(page.locator("#h-profit")).to_have_value("30")
        expect(page.locator("#h-count")).to_have_count(0)                              # the plan: on the house page
        expect(page.locator("#h-areas .chip:has(input:checked)")).to_have_text(["Cozinha", "Banheiros", "Edícula"])
        page.locator("#h-areas .chip", has_text="Banheiros").click()                    # an area with a cost...
        page.click("dialog >> text=Salvar")
        expect(page.locator(".toast.error").last).to_contain_text("tem custos lançados")   # ...is not removed
        errors[:] = [e for e in errors if "status of 400" not in e]                  # that 400 was on purpose
        page.locator("#h-areas .chip", has_text="Banheiros").click()
        page.select_option("#h-status", "ready")
        page.click("dialog >> text=Salvar")
        expect(page.locator("h1 .badge")).to_have_text("Pronta")
        page.click("text=‹ Casas")
        expect(page.locator(".list-item")).to_have_count(1)
        expect(page.locator("#portfolio")).to_contain_text("321.000,00")
        expect(page.locator(".list-item")).to_contain_text("vender por R$ 417.300,00")           # 321.000 + 30%

        # deleting the house
        page.locator(".list-item", has_text="Casa Azul").click()
        page.click("button.danger:has-text('Excluir')")
        expect(page.locator(".empty-state")).to_be_visible()
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
        expect(page.locator(".list-item")).to_have_count(4)
        page.locator(".list-item", has_text="Sobrado Vila Nova").click()
        expect(page.locator(".bars").last.locator("li")).to_have_count(4)               # categories
        expect(page.locator("#areas li")).to_have_count(3)                              # Telhado, Hidráulica, Sem área
        expect(page.locator("#areas li").first).to_contain_text("Telhado")
        expect(page.locator("#areas")).to_contain_text("Ainda sem custos: Banheiros, Cozinha")
        expect(page.locator("#expenses tbody tr")).to_have_count(7)
        expect(page.locator("#installments tbody tr")).to_have_count(12)               # a page of a long plan
        expect(page.locator("#installments .pager-page")).to_contain_text("de 10")
        width = page.evaluate("document.documentElement.scrollWidth")
        assert width <= 390, f"the page scrolls sideways on a phone ({width}px)"
        browser.close()
    server.shutdown()
    assert not errors, errors
    print("e2e without login: ok")


if __name__ == "__main__":
    run()
    run_without_login()
