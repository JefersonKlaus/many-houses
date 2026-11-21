# Many Houses

Manages houses bought to be renovated, serverless on AWS. For each house: what it cost to buy
(price + ITBI, deed, broker...) and every renovation cost (material, labor, services, project,
other), with the totals per house, per category and for all houses together.

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
    domain/          entities (House, Expense) and validation, pure Python
    ports.py         what use cases need: the Repository
    application.py   rules shared by several use cases (lookups, limits, totals)
    adapters/        DynamoDB, API Gateway input (login, ids, errors)
  lambdas/<action>/  list_houses, get_house, create_house, update_house, delete_house,
                     create_expense, update_expense, delete_expense
    use_case.py      the action (only domain + ports, never AWS)
    handler.py       API Gateway event -> use case -> HTTP response
    lambda.json      {"route": "POST /houses", "database": "write"}
```

| Route | What it does |
|---|---|
| `GET /houses` | every house, each with its totals (purchase, renovation, total) |
| `POST /houses` · `PUT /houses/{id}` · `DELETE /houses/{id}` | register, change, delete a house (with its costs) |
| `GET /houses/{id}` | one house, its costs (newest first) and its totals by category |
| `POST /houses/{id}/expenses` | add a renovation cost |
| `PUT` · `DELETE /houses/{id}/expenses/{expense_id}` | change, delete a renovation cost |

To add an action, create a folder with these three files. Terraform reads every `lambda.json` and
creates the function, the route and the logs. Lambdas marked `"read"` can only read the table.

Rules worth knowing:

- The owner comes from the login token (`sub`), never from the request: each login sees only its houses.
- Money is always integer cents (`purchase_price_cents`, `amount_cents`...), never a float.
- Purchase = price + purchase costs. Total invested = purchase + every renovation cost.
- Deleting a house deletes its costs first, so no orphan is left behind.
- DynamoDB, one table: `PK = OWNER#<user>`, `SK = HOUSE#<id>` or `EXP#<house id>#<id>`.

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

Actions → *Create user* → choose the environment and type the e-mail. Cognito e-mails a temporary
password. There is no open sign-up.

## Security and cost

- Encrypted table with continuous backups; deletion protection in `prod`.
- API Gateway rate-limits requests. The site may only talk to itself, Cognito and the API (CSP).
- Pay-per-use: close to zero with no traffic.
