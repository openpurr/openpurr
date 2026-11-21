# Price experiments

Test what your app should charge by showing customers new to the app different offerings, then
comparing what each group buys. Your app needs no changes: while an experiment runs,
`Purchases.getOfferings()` returns the customer's variant as the `current` offering.

Price experiments are part of openpurr Lite, managed on the dashboard's **Experiments** page.

## How it works

- **Prices stay in the stores.** Apple and Google set the price of each product, so each price you
  want to test is its own product (for example `pro_annual` at $49.99 and `pro_annual_59` at
  $59.99). Each variant's products go in their own offering.
- **Variants are offerings.** An experiment has two to four variants, each an offering from your
  config with a share of new customers. The first variant is the control: usually the offering
  customers see today.
- **Only customers new to the app take part.** That means an app user ID openpurr hasn't seen, or a
  customer first seen after the experiment started. Existing customers keep seeing the current
  offering, so nobody's price changes under them.
- **Each person keeps their variant.** Assignment is random by the shares, and fixed by app user
  ID. After `logIn`, any of the customer's app user IDs finds it; if a customer has joined under
  two IDs, the earliest enrollment wins.
- **Every offering is still listed.** Only `current` changes. A paywall that asks for an offering
  by ID gets that offering, whatever the variant.
- **One experiment runs per project at a time,** so each customer is in at most one.

## Running an experiment

1. **Create the products** in App Store Connect and Play Console, and add them to the config
   (**Apps and products**).
2. **Make an offering per variant** (**Offerings**). Use the same package identifiers in each
   (`$rc_annual`, `$rc_monthly`…), so your paywall shows every variant the same way.
3. **Create the experiment** (**Experiments → New experiment**): name it, pick the control and
   the other offerings, and set the shares. It starts as a draft, and you can change anything.
4. **Start it.** Apps pick it up within a minute. From then on, the variants can't change: the
   customers are already split.
5. **Check the results.** Give the experiment the time you planned, for example two full billing
   cycles for monthly plans, before you decide.
6. **Stop it.** Everyone sees the current offering again, and no one new joins. To keep the
   winner, make its offering the current one on the **Offerings** page.

Try it on sandbox first: test purchases count in the **Sandbox** results, and production ones in
**Production**.

## Results

For each variant, the Experiments page shows:

| Metric | What it counts |
| --- | --- |
| Customers | People who joined: the app fetched offerings for them while the experiment ran. |
| Trials started, Trials converted | Free trials started, and those followed by a paid purchase. |
| Paying customers | Customers with at least one paid purchase that wasn't refunded, and their share of all customers. |
| Revenue, Revenue per customer | USD at each purchase date's exchange rate, net of refunds. Revenue per customer divides by every customer in the variant, paying or not. |
| Active subscriptions, MRR | Subscriptions active now, and their monthly recurring revenue. |
| Churned subscribers | Paying subscribers whose subscriptions have all ended. |
| What paying customers bought first | Each paying customer's first paid product. |

**What counts:** purchases that start a new purchase between a customer joining and the
experiment's end, with everything those subscriptions do afterwards (renewals, refunds, churn) up
to now. Results keep counting renewals after the experiment stops.

**Chance higher:** for each variant against the control, the page shows the difference
(`+9.4%`) and the chance that the variant's true conversion rate, or revenue per customer, is
higher than the control's. A variant is called **likely better** or **likely worse** at a 95% chance
on revenue per customer. That only happens once each variant has at least 100 customers and there
are at least 20 paying customers between it and the control; before that, the page says **too
early to tell**. Conversion uses Beta posteriors and revenue per customer a normal approximation;
both compare the two variants with a normal approximation of their difference.

Checking every day and stopping at the first good-looking day overstates the winner. Pick the
end date before you start, and decide then.

Results are computed from the purchase records and kept for 5 minutes (the refresh button
recomputes them, at most once a minute). Computing them reads about two database rows per
customer in the experiment, plus their purchases. On Cloudflare's free plan, which allows 5 million
rows read a day, that's plenty for experiments with tens of thousands of customers.

## Webhooks

Events about a customer in an experiment carry RevenueCat's `experiments` field, so existing
handlers can attribute revenue to variants:

```json
"experiments": [
  { "experiment_id": "exp_WKaiG92HHG7ROwP1", "experiment_variant": "b", "enrolled_at_ms": 1759795200000 }
]
```

Customers in no experiment don't get the field. The customer's page in the dashboard also shows
their experiments and variants.

## API and MCP

The dashboard uses the admin API, which you can call with an access token:

| Request | Does |
| --- | --- |
| `GET /admin/v1/experiments?project=<id>` | Lists a project's experiments. |
| `POST /admin/v1/experiments` | Creates a draft: `{"project", "name", "notes", "variants": [{"offering_id", "weight"}, …]}`. Weights are whole percents adding up to 100. |
| `PATCH /admin/v1/experiments/<id>` | Changes the name or notes, and the variants of a draft. |
| `POST /admin/v1/experiments/<id>/start`, `/stop` | Starts a draft, or stops a running experiment. |
| `DELETE /admin/v1/experiments/<id>` | Deletes a draft or stopped experiment, with its enrollments. |
| `GET /admin/v1/experiments/<id>/results?environment=production` | The results (`environment=sandbox` for test purchases; `refresh=1` to recompute). |

Creating, changing, starting and stopping experiments needs the `config:manage` permission (admins
and owners; tokens with the `write:config` scope). Every change is in the audit log. Results add up
purchases across every app, so only operators who can see every app get them.

The MCP tool `get_experiments` lists a project's experiments with their results, so you can ask an
assistant how an experiment is going.

## Limits

- One running experiment per project.
- Experiments split customers new to the app; they don't change what existing customers see.
- No targeting by country, app or app version yet. An experiment covers all of a project's apps.
- If you remove a variant's offering from the config while the experiment runs, that variant's
  customers see the current offering instead, and `openpurr doctor` warns about it.
