"""Demo data for the local server, so the app opens looking like it is in real use: a few houses in
different stages (one being renovated, one ready, one sold, one just bought) with their renovation costs.

Dates are relative to today, so the data always looks recent. Only used by `python local/server.py`
(and `python dev.py serve`); the tests start from an empty database."""
from __future__ import annotations

from datetime import date, timedelta

from houses_core.domain.models import Expense, House, new_id
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


def seed(deps: Dependencies, owner: str, today: date) -> None:
    for name, address, days_ago, price, costs, status, notes, expenses in HOUSES:
        house = House(new_id(), name, address, (today - timedelta(days=days_ago)).isoformat(), price, costs, status, notes)
        deps.repo.save_house(owner, house)
        for ago, category, description, supplier, amount in expenses:
            deps.repo.save_expense(owner, Expense(new_id(), house.id, (today - timedelta(days=ago)).isoformat(),
                                                  category, description, amount, supplier))
