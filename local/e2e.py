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
        page.click("dialog >> text=Salvar")
        expect(page.locator("h1")).to_contain_text("Casa Azul")
        expect(page.locator("#house-totals")).to_contain_text("318.000,00")

        # two renovation costs, then one is changed and the other deleted
        for description, category, amount in (("Cimento e areia", "material", "1.500,50"),
                                              ("Pedreiro", "labor", "4.000")):
            page.click("text=Novo custo")
            page.fill("#e-description", description)
            page.select_option("#e-category", category)
            page.fill("#e-amount", amount)
            page.click("dialog >> text=Salvar")
            expect(page.locator("#expenses tbody")).to_contain_text(description)
        expect(page.locator("#house-totals")).to_contain_text("5.500,50")       # renovation
        expect(page.locator("#house-totals")).to_contain_text("323.500,50")     # total
        expect(page.locator(".bars")).to_contain_text("Mão de obra")

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
        page.select_option("#h-status", "ready")
        page.click("dialog >> text=Salvar")
        expect(page.locator("h1 .badge")).to_have_text("Pronta")
        page.click("text=‹ Casas")
        expect(page.locator(".list-item")).to_have_count(1)
        expect(page.locator("#portfolio")).to_contain_text("321.000,00")

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
        expect(page.locator(".bars li")).to_have_count(4)
        expect(page.locator("#expenses tbody tr")).to_have_count(7)
        width = page.evaluate("document.documentElement.scrollWidth")
        assert width <= 390, f"the page scrolls sideways on a phone ({width}px)"
        browser.close()
    server.shutdown()
    assert not errors, errors
    print("e2e without login: ok")


if __name__ == "__main__":
    run()
    run_without_login()
