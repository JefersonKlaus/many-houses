"""Demo data for the local server, so the app opens looking like it is in real use: a few houses in
different stages (one being renovated, one ready, one sold, one just bought) with their renovation costs.
Two of them were bought in installments: an entrada and monthly prestações, the ones already due are paid.
Each house has the areas that needed renovation, and most costs are linked to one of them.
The Sobrado was bought with a partner (each one paid part of it), and another partner sent an invite
for one of their houses, waiting to be accepted. The Sobrado also has a timeline of photos, from the
purchase on, and photos of the invoice and of the material on two of its costs (drawn, not real photos).

Dates are relative to today, so the data always looks recent. Only used by `python local/server.py`
(and `python dev.py serve`); the tests start from an empty database."""
from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta

from houses_core.domain.models import (OWNER_MEMBER_ID, Area, Expense, House, Installment, Invite, Partner,
                                       PendingInvite, RecurringBill, Share, TimelineEntry, add_months, new_id,
                                       photo_key)
from houses_core.ports import Dependencies

R = 100     # R$ 1,00 in cents

HOUSES = [  # name, address, bought N days ago, price, purchase costs, status, notes, costs
    ("Casa da Rua das Flores", "Rua das Flores, 120 - Jardim América, Campinas/SP", 210, 380_000 * R, 22_800 * R,
     "sold", "Vendida após 5 meses de reforma.", [
         (200, "project", "Projeto de reforma e ART", "Arq. Paula Lima", 4_500 * R),
         (190, "labor", "Demolição e retirada de entulho", "Construtora Bom Lar", 6_200 * R),
         (185, "services", "Caçamba de entulho (3 unidades)", "Disk Caçamba", 1_350 * R),
         (170, "material", "Cimento, areia e blocos", "Depósito São José", 8_940 * R),
         (150, "material", "Pisos porcelanato 80x80", "Casa dos Pisos", 14_300 * R),
         (140, "labor", "Assentamento de piso e revestimentos", "Construtora Bom Lar", 9_800 * R),
         (120, "material", "Louças e metais dos banheiros", "Leroy Merlin", 7_650 * R),
         (110, "services", "Instalação elétrica nova", "Eletricista Marcos", 5_400 * R),
         (90, "labor", "Pintura interna e externa", "Pinturas Silva", 7_200 * R),
         (85, "services", "Limpeza de calhas e telhado", "Telhados Andrade", 900 * R),
         (80, "material", "Portas internas", "Madeireira Central", 3_200 * R),
         (75, "other", "Paisagismo do jardim", "Verde Vivo", 1_850 * R),     # 12 costs: two pages
     ]),
    ("Apartamento Centro 302", "Av. Brasil, 455, ap. 302 - Centro, Campinas/SP", 120, 290_000 * R, 17_400 * R,
     "ready", "", [
         (110, "labor", "Remoção de revestimentos da cozinha", "João Reformas", 2_400 * R),
         (100, "material", "Revestimentos cozinha e área de serviço", "Casa dos Pisos", 4_980 * R),
         (95, "material", "Bancada de granito", "Marmoraria Pedra Bela", 3_600 * R),
         (80, "labor", "Mão de obra cozinha", "João Reformas", 4_500 * R),
         (60, "material", "Tinta acrílica e massa corrida", "Tintas Cor & Arte", 2_150 * R),
         (55, "labor", "Pintura completa", "Pinturas Silva", 3_800 * R),
         (40, "other", "Limpeza pós-obra", "Limpa Fácil", 650 * R),
     ]),
    ("Sobrado Vila Nova", "Rua Itapura, 88 - Vila Nova, Campinas/SP", 45, 520_000 * R, 31_200 * R,
     "renovating", "Telhado precisa de troca completa. Previsão de término em 3 meses.", [
         (40, "project", "Laudo estrutural", "Eng. Roberto Alves", 2_800 * R),
         (35, "project", "Alvará de reforma na prefeitura", "Prefeitura de Campinas", 980 * R),
         (30, "labor", "Retirada do telhado antigo", "Telhados Andrade", 5_500 * R),
         (25, "material", "Madeiramento e telhas", "Madeireira Central", 18_700 * R),
         (20, "labor", "Montagem do telhado novo", "Telhados Andrade", 12_000 * R),
         (12, "material", "Tubos e conexões hidráulicas", "Depósito São José", 3_240 * R),
         (5, "services", "Encanador: troca da rede hidráulica", "Hidráulica Souza", 4_600 * R),
     ]),
    ("Casa Jardim Europa", "Rua Holanda, 17 - Jardim Europa, Valinhos/SP", 6, 345_000 * R, 20_700 * R,
     "renovating", "Recém-comprada: orçamentos em andamento.", [
         (2, "project", "Levantamento e orçamento da reforma", "Arq. Paula Lima", 1_200 * R),
     ]),
]


# house name: {area: [descriptions of the costs linked to it]}; a cost not listed has no area
AREAS = {
    "Casa da Rua das Flores": {
        "Pisos": ["Pisos porcelanato 80x80", "Assentamento de piso e revestimentos"],
        "Banheiros": ["Louças e metais dos banheiros"],
        "Elétrica": ["Instalação elétrica nova"],
        "Pintura": ["Pintura interna e externa"],
    },
    "Apartamento Centro 302": {
        "Cozinha": ["Remoção de revestimentos da cozinha", "Revestimentos cozinha e área de serviço",
                    "Bancada de granito", "Mão de obra cozinha"],
        "Pintura": ["Tinta acrílica e massa corrida", "Pintura completa"],
    },
    "Sobrado Vila Nova": {
        "Telhado": ["Retirada do telhado antigo", "Madeiramento e telhas", "Montagem do telhado novo"],
        "Hidráulica": ["Tubos e conexões hidráulicas", "Encanador: troca da rede hidráulica"],
        "Banheiros": [],
        "Cozinha": [],
    },
    "Casa Jardim Europa": {"Cozinha": [], "Banheiros": [], "Fachada": []},
}

TARGET_PROFIT = {"Casa da Rua das Flores": 25, "Apartamento Centro 302": 20}   # % wanted; the others, 30

PLANS = {  # house name: entrada, number of monthly installments, each one's amount
    "Apartamento Centro 302": (90_000 * R, 36, 5_900 * R),
    "Sobrado Vila Nova": (156_000 * R, 120, 3_480 * R),
}


# The bills each house has every month: (name, when it is due, relative to today) and, for the ones already paid,
# the payments: (name, days ago, amount). So the houses list has warnings: "in 2 days", "tomorrow", "late" and a paid one.
BILLS = {
    "Sobrado Vila Nova": [("Energia", +2), ("Água", -3), ("Internet", +1), ("IPTU", +20)],
    "Apartamento Centro 302": [("Condomínio", +2), ("Energia", +15)],
}
BILL_PAYMENTS = {
    "Sobrado Vila Nova": [("Energia", 28, 412 * R), ("Água", 29, 138 * R), ("Internet", 0, 119 * R)],
    "Apartamento Centro 302": [("Condomínio", 28, 650 * R), ("Energia", 20, 187 * R)],
}
# The next installment to pay is due in this many days
DUE_IN = {"Apartamento Centro 302": 2, "Sobrado Vila Nova": 1}

PARTNER_USER, PARTNER_PHONE, PARTNER_NAME = "demo-partner", "+5511988887777", "Marcos Pereira"
PARTNER_ID = "5a5a5a5a"
SHARED = "Sobrado Vila Nova"
PAID_BY_PARTNER = {"Retirada do telhado antigo", "Madeiramento e telhas", "Montagem do telhado novo"}


def seed(deps: Dependencies, owner: str, today: date, phone: str = "", user_name: str = "") -> None:
    for name, address, days_ago, price, costs, status, notes, expenses in HOUSES:
        bought = (today - timedelta(days=days_ago)).isoformat()
        down_payment, count, amount = PLANS.get(name, (0, 0, 0))
        areas = {area: Area(new_id(), area) for area in AREAS.get(name, {})}
        area_of = {description: areas[area].id for area, descriptions in AREAS.get(name, {}).items()
                   for description in descriptions}
        house = House(new_id(), name, address, bought, price, costs, status, notes, down_payment,
                      "installments" if count else "cash", TARGET_PROFIT.get(name, 30), tuple(areas.values()),
                      phone)
        shared = name == SHARED
        if shared:      # bought with a partner: the entrada + costs (R$ 187.200) split in half
            half = house.upfront_cents // 2
            house = replace(house, partners=(Partner(PARTNER_ID, PARTNER_USER, PARTNER_PHONE, PARTNER_NAME),),
                            purchase_shares=(Share(OWNER_MEMBER_ID, house.upfront_cents - half), Share(PARTNER_ID, half)))
            deps.repo.save_link(PARTNER_USER, owner, house.id)
        bills = tuple(RecurringBill(new_id(), bill, (today + timedelta(days=due)).day) for bill, due in BILLS.get(name, ()))
        deps.repo.save_house(owner, replace(house, owner_name=user_name, recurring_bills=bills))
        first_due = add_months(bought, 1)
        dues = [add_months(first_due, n) for n in range(count)]
        installments = [Installment(new_id(), house.id, due, amount, due if due <= today.isoformat() else "",
                                    (PARTNER_ID if shared and n % 2 else OWNER_MEMBER_ID) if due <= today.isoformat() else "")
                        for n, due in enumerate(dues)]
        if name in DUE_IN:
            open_ = [n for n, i in enumerate(installments) if not i.paid]
            installments[open_[0]] = replace(installments[open_[0]], due_date=(today + timedelta(days=DUE_IN[name])).isoformat())
        deps.repo.save_installments(owner, installments)
        for bill, ago, cents in BILL_PAYMENTS.get(name, ()):
            deps.repo.save_expense(owner, Expense(new_id(), house.id, (today - timedelta(days=ago)).isoformat(),
                                                  "recurring", bill, cents))
        for ago, category, description, supplier, amount in expenses:
            photos = {"nf_photo": "", "material_photo": ""}
            if shared and description in PHOTOS_OF_COSTS:
                photos = {field: picture(deps, owner, house.id, text, color)
                          for field, (text, color) in PHOTOS_OF_COSTS[description].items()}
            deps.repo.save_expense(owner, Expense(new_id(), house.id, (today - timedelta(days=ago)).isoformat(),
                                                  category, description, amount, supplier,
                                                  area_of.get(description, ""),
                                                  PARTNER_ID if shared and description in PAID_BY_PARTNER else "",
                                                  **photos))
        if shared:
            for ago, caption, pictures in TIMELINE:
                deps.repo.save_timeline_entry(owner, TimelineEntry(
                    new_id(), house.id, (today - timedelta(days=ago)).isoformat(), caption,
                    tuple(picture(deps, owner, house.id, text, color) for text, color in pictures)))
    invite_waiting(deps, today, phone)


# The Sobrado's timeline: days ago, what it shows, its pictures (text, color)
TIMELINE = [
    (45, "Dia da compra: a casa como estava", [("Fachada", "#8d6e63"), ("Sala", "#a1887f"), ("Telhado", "#6d4c41")]),
    (30, "Telhado antigo retirado", [("Sem telhado", "#c25e00")]),
    (20, "Madeiramento e telhas novas", [("Madeiramento", "#1d6b5a"), ("Telhas", "#2e7d32")]),
    (5, "Rede hidráulica trocada", [("Hidráulica", "#3f51b5")]),
]
PHOTOS_OF_COSTS = {         # cost: {field: (text, color)}
    "Madeiramento e telhas": {"nf_photo": ("NF 1234", "#757575"), "material_photo": ("Telhas", "#2e7d32")},
    "Tubos e conexões hidráulicas": {"nf_photo": ("NF 5678", "#757575")},
}


def picture(deps: Dependencies, owner: str, house_id: str, text: str, color: str) -> str:
    """A drawn "photo" (an SVG with a color and a text) kept like an uploaded one. Returns its id."""
    photo_id = new_id()
    if deps.photos is not None:
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" '
               f'fill="{color}"/><text x="400" y="320" font-size="64" font-family="sans-serif" fill="#fff" '
               f'text-anchor="middle">{text}</text></svg>')
        deps.photos.put(photo_key(owner, house_id, photo_id), "image/svg+xml", svg.encode())
    return photo_id


def invite_waiting(deps: Dependencies, today: date, phone: str) -> None:
    """A house of the demo partner, with an invite to `phone` (the local user) not answered yet."""
    if not phone:
        return
    invite = Invite(new_id(), phone, today.isoformat())
    house = House(new_id(), "Casa Vila Rica", "Rua Ipê, 45 - Vila Rica, Campinas/SP",
                  (today - timedelta(days=20)).isoformat(), 410_000 * R, 24_600 * R, "renovating", "",
                  0, "cash", 25, (Area(new_id(), "Cozinha"),), PARTNER_PHONE, (), (invite,), (), PARTNER_NAME)
    deps.repo.save_house(PARTNER_USER, house)
    deps.repo.save_pending_invite(PendingInvite(invite.id, phone, PARTNER_USER, house.id, house.name,
                                                PARTNER_PHONE, invite.date, PARTNER_NAME))
