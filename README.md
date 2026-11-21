# Many Houses

Manages houses bought to be renovated, serverless on AWS. For each house: what it cost to buy
(price + ITBI, deed, broker...), how it was paid (cash, or entrada + monthly installments, each one
marked when paid) and every renovation cost (material, labor, services, project, other), each one
linked to the area of the house it went to (kitchen, roof...), with the totals per house, per
category, per area (which part costs the most) and for all houses together. Given the profit wanted
(%), it tells for how much to sell each house today, as it is. A house bought with partners is
shared with them (invited by phone), and the app shows how much each one put in.

The app's screens are in Brazilian Portuguese; code and docs are in English.

## Run it locally

Needs Python 3.12+ (and Node 22 for the JS syntax check).

```bash
python dev.py setup             # once: creates .venv/ and downloads Chromium
python dev.py serve             # http://127.0.0.1:8765
python dev.py serve --empty     # start with nothing registered
```

No AWS, no login, no configuration. It opens with demo data ([local/seed.py](local/seed.py)): four
houses in different stages (being renovated, ready, sold, just bought) with their renovation costs,
always dated around today. Data lives in memory and is gone when you stop the server.

## Run the tests

```bash
python dev.py test    # backend tests + JS syntax (seconds)
python dev.py e2e     # browser test in a real Chromium
python dev.py all     # both: what CI runs
```

| Tests | Where |
|---|---|
| Backend (rules, API, DynamoDB format, frontend ↔ API contract) | `local/tests/` (pytest) |
| Whole app in a browser | `local/e2e.py` (Playwright) |

## Architecture

```
Browser ──► CloudFront ──► S3                 the site (HTML/CSS/JS, no build)
   │
   └──► API Gateway ──► one Lambda per action ──► DynamoDB
        (checks the Cognito login)
```

```
frontend/   the site                         deployed to S3
backend/    the Lambdas                      deployed to AWS Lambda
infra/      Terraform for everything in AWS
local/      local server, in-memory database, tests   never deployed
dev.py      the commands above
```

### Frontend

Plain JavaScript modules, no framework, no build step.

```
frontend/
  index.html, style.css
  js/app.js            menu and login screen
  js/api.js            every call to the backend
  js/auth.js           Cognito login (tokens)
  js/config.js         where the API is (written by the deploy; empty in the repo)
  js/screens/houses.js the houses: list, one house's page, the forms
```

The frontend doesn't know whether the backend is AWS or local: it calls `CONFIG.apiUrl`.
The deploy writes a `config.js` with the real API; the local server returns its own `config.js`
pointing at itself, with `skipLogin: true`.

### Backend

One Lambda per business action, hexagonal: each Lambda has its use case and its HTTP adapter;
everything else lives in a shared core, copied into every Lambda's zip.

```
backend/
  core/houses_core/
    domain/          entities (House and its Areas, Expense, Installment) and validation, pure Python
    ports.py         what use cases need: the Repository
    application.py   rules shared by several use cases (lookups, limits, totals)
    adapters/        DynamoDB, API Gateway input (login, ids, errors)
  lambdas/<action>/  list_houses, get_house, create_house, update_house, delete_house,
                     create_expense, update_expense, delete_expense,
                     create_installments, update_installment, delete_installment,
                     create_invite, delete_invite, list_invites, accept_invite, decline_invite,
                     remove_partner
    use_case.py      the action (only domain + ports, never AWS)
    handler.py       API Gateway event -> use case -> HTTP response
    lambda.json      {"route": "POST /houses", "database": "write"}
```

| Route | What it does |
|---|---|
| `GET /houses` | every house, each with its totals (purchase, renovation, total) |
| `POST /houses` · `PUT /houses/{id}` · `DELETE /houses/{id}` | register (bought in installments: with its plan, `installments`; bought with partners: `owner_share_cents` and `partners` [{phone, cents}]), change, delete a house (with its costs) |
| `GET /houses/{id}` | one house: its costs (newest first), its installments (in due order) and its totals |
| `POST /houses/{id}/expenses` | add a renovation cost |
| `PUT` · `DELETE /houses/{id}/expenses/{expense_id}` | change, delete a renovation cost |
| `POST /houses/{id}/installments` | add N monthly installments at once (`count`, `amount_cents`, `first_due_date`) |
| `PUT` · `DELETE /houses/{id}/installments/{installment_id}` | change (or mark as paid: `paid_date`, `paid_by`), delete an installment |
| `POST /houses/{id}/invites` · `DELETE /houses/{id}/invites/{invite_id}` | invite a partner by phone, cancel an invite |
| `GET /invites` · `POST /invites/{id}/accept` · `POST /invites/{id}/decline` | the invites sent to the login's phone; accept, decline one |
| `DELETE /houses/{id}/partners/{partner_id}` | remove another partner with nothing paid registered |

Every change to a house (all but `DELETE /houses/{id}`) answers the same thing as `GET /houses/{id}`:
the screen draws the house's page from that answer, with no second request.

To add an action, create a folder with these three files. Terraform reads every `lambda.json` and
creates the function, the route and the logs. Lambdas marked `"read"` can only read the table.

Rules worth knowing:

- The user comes from the login token (`sub`, and `phone_number` for invites), never from the request:
  each login sees only its houses and the ones it is a partner in.
- Partners: a house registered as bought with partners says how much each one paid at the purchase
  (what was paid up front: cash price or entrada, plus the costs; the shares must add up to it). That
  split is only set when registering. Each partner is invited by phone; the invite waits under that
  phone (even before that person has a login) and shows on top of their list to accept or decline;
  accepting, they keep the invite's id, so their share stays theirs. The owner can invite more
  partners later (they have no share of the purchase). Partners are all equal: any of them changes
  everything, invites, removes another partner and deletes the house. The only difference is
  technical: the house is kept in the data of whoever registered it, so that one can't be removed.
  Each cost and paid installment has `paid_by` (a member; empty = whoever registered the house; by
  default whoever registers the payment); with the purchase
  shares, `totals.by_member` says how much each one put in.
- The login is the phone: the screen takes DDD + number (digits only) and sends `+55<digits>` to Cognito.
- Money is always integer cents (`purchase_price_cents`, `amount_cents`...), never a float.
- Purchase = price + purchase costs. Total invested = purchase + every renovation cost.
- `payment_type` is `cash` or `installments`. In installments: entrada (`down_payment_cents`, at most
  the price) + installments, registered with the house and each one paid when it has a `paid_date`.
  Paid so far = entrada + the paid installments. A cash house has no entrada and takes no installment.
- Suggested sale price today = total invested (purchase + renovation) + `target_profit_percent` of it.
- A house lists the areas that need renovation (`areas`: the names; the API gives each an id, kept
  while the name is the same, ignoring case). A cost may be linked to one (`area_id`). An area with
  costs can't be removed until they move to another area or to none.
- Deleting a house deletes its costs, installments, partners' links and pending invites first, so no
  orphan is left behind.
- DynamoDB, one table: `PK = OWNER#<user>`, `SK = HOUSE#<id>`, `EXP#<house id>#<id>`,
  `INST#<house id>#<id>` or `LINK#<house id>` (a partner's link to the owner's house, which stays in
  the owner's partition); `PK = PHONE#<phone>`, `SK = INVITE#<id>` for the invites waiting. A payment
  plan is written with `BatchWriteItem`, 25 items per call.
- Every list and table shows 10 rows a page. Sold houses are hidden from the list until asked for,
  and always come last (the rest by name, then the sold ones by name).

### Local

`local/server.py` serves `frontend/` and plays API Gateway: `local/api_gateway.py` reads the same
`lambda.json` files and calls the same Lambdas, with `local/memory_repository.py` instead of
DynamoDB. It only listens on 127.0.0.1.

## Deploy

Everything goes through GitHub Actions, with no terminal: a push runs every test (Python, JS and the
browser test), then Terraform creates or updates all of AWS (Lambdas, API, Cognito, table, site),
then the site is published. Two environments, each in its own AWS account:

| Environment | Deploys when |
|---|---|
| `dev` | every push to the `dev` branch |
| `prod` | every push to `main` (a merged PR); also by hand: Actions → *Deploy production* → *Run workflow*, typing `producao` |

```
push ──► tests (CI) ──► terraform plan ──► check the plan ──► terraform apply ──► publish the site
```

The deploy **refuses a plan that would delete or recreate the Cognito user pool or the DynamoDB
table** (every login and all the data): that stops it before anything is applied.

### One-time setup

1. **In each AWS account:** create an IAM policy from [`docs/iam-deploy-policy.json`](docs/iam-deploy-policy.json)
   (it only touches `many-houses-*` resources), a user without console access with that policy,
   and an access key for it.
2. **On GitHub** (Settings → Environments), create `dev` and `producao`, each with:
   - secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
   - variables `AWS_ACCOUNT_ID` (the deploy stops if the key is from another account) and `AWS_REGION`
3. **First deploy:** create the `dev` branch. The site's address shows up in the Actions run summary.
4. Recommended for `producao`: *Required reviewers* (you approve each deploy) and *Deployment
   branches* = only `main`.

### Create a login

Actions → *Create user* → choose the environment, type the phone (DDD + number, digits only, e.g.
`11987654321`) and an e-mail. The person logs in with that phone; Cognito e-mails the temporary
password, which is changed on the first access. There is no open sign-up.

## Security and cost

- Encrypted table with continuous backups; deletion protection in `prod`.
- API Gateway rate-limits requests. The site may only talk to itself, Cognito and the API (CSP).
- Pay-per-use: close to zero with no traffic.
