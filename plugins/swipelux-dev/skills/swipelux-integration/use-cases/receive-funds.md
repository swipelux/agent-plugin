# Use case: receive funds (one-time bank pay-in to a wallet)

**Outcome.** The developer's backend can collect a specific fiat amount from a customer and settle it as stablecoin into the customer's Swipelux wallet. The backend prices the pay-in with a quote and executes it as a transfer. It then shows the payer the transfer's own bank instructions: account, routing, amount and the required reference. The backend follows the transfer until it is `completed` and the wallet balance is credited. This sequence was run end to end in sandbox on 2026-10-23 with an individual customer and the `ach_pooled` capability. A 150.00 USD pay-in settled 149.25 USDC.

For reusable bank details that accept any amount at any time, use `bank-accounts.md` instead.

## Conventions for every call

- Base URL `https://platform.swipelux.com`. Send header `X-API-Key` from server-side config only.
- Every POST, PUT, PATCH and DELETE needs an `Idempotency-Key` header. Use one new UUID per intended operation and persist it before sending. On a timeout or 5xx, retry with the same key and body. On a 4xx the key is spent: fix the input and use a new key.
- Responses wrap the resource in `data`. Errors are problem+json with `code`, `detail` and `errors[].pointer`.
- Unknown query parameters return `400 unknown_parameter`.

## Call sequence

### 1. Create the customer

`POST /v3/customers` with the profile you already hold. Only `type` is required. Prefilling lets the onboarding task ask only for documents:

```json
{
  "type": "individual",
  "externalId": "<your user id>",
  "individual": {
    "firstName": "Amina", "lastName": "Diallo",
    "email": "amina@example.com", "phone": "+14155551234",
    "birthDate": "1990-04-12", "residenceCountry": "US",
    "residentialAddress": { "streetLine1": "1 Market Street", "city": "San Francisco", "state": "CA", "postalCode": "94105", "country": "US" },
    "taxIdentifiers": [{ "type": "ssn", "country": "US", "value": "123456789" }],
    "identityDocuments": [{ "type": "passport", "issuingCountry": "US", "number": "X12345678", "expiresOn": "2031-01-01" }]
  },
  "financialProfile": { "accountPurposes": ["personal_expenses"] }
}
```

Keep `data.id` as `CUSTOMER_ID`.

### 2. Upload documents (multipart)

`POST /v3/customers/{CUSTOMER_ID}/documents` as `multipart/form-data` with a `file` part (raw bytes) and a `type` part. Upload `passport_front` and `selfie`, and keep each `doc_` id. The selfie is reused automatically. The identity document still needs a submission with metadata (step 4).

### 3. Pick and request a pay-in capability

`GET /v3/customers/{CUSTOMER_ID}/capabilities/supported`. Choose an entry with `payin` in `directions`, `availability` of `available` or `beta`, and `eligibility.eligible: true`. Prefer `accountType: "pooled"` for one-time pay-ins. Keep its `id` as `CAPABILITY_ID`, for example `ach_pooled`. Pooled SWIFT cannot receive.

`POST /v3/customers/{CUSTOMER_ID}/capabilities/{CAPABILITY_ID}` with `{}`. Keep `data.status` and `data.openTaskIds`. Expect `restricted` with `statusReason.code: "tasks_due"` and one intake task.

### 4. Complete the onboarding task

`GET /v3/customers/{CUSTOMER_ID}/tasks/{TASK_ID}`. With the prefilled profile, only `identity_document` was `action_required`, and `selfie` was already `in_review`. The task also carries one `tosSessions[]` entry, a hosted terms page the end customer must accept at `action.url`. The task cannot complete until that session is `completed`.

`POST /v3/customers/{CUSTOMER_ID}/tasks/{TASK_ID}/submissions`:

```json
{
  "taskRevision": 2,
  "answers": [
    {
      "requirementId": "req_<identity_document>",
      "answer": {
        "type": "document",
        "documentIds": ["doc_<passport_front>"],
        "documentMetadata": [{ "documentId": "doc_<passport_front>", "idNumber": "X12345678", "issuingCountry": "US" }]
      }
    }
  ]
}
```

Take `taskRevision` from the latest task read. The call returns `201` with `outcome: "in_review"`.

### 5. (Sandbox only) Accept the review

`POST /v3/sandbox/tasks/{TASK_ID}/review` with `{"outcome":"accepted"}`. The task becomes `satisfied`. Then `GET /v3/customers/{CUSTOMER_ID}/capabilities/{CAPABILITY_ID}` returned `ready` with `openTaskIds: []`. The capability-status force helper was not needed. Continue only on `ready`.

### 6. Get or create the settlement wallet

`GET /v3/customers/{CUSTOMER_ID}/accounts?origin=issued&type=wallet`. Reuse a `ready` wallet in the target stablecoin. Otherwise `POST /v3/customers/{CUSTOMER_ID}/accounts`:

```json
{ "origin": "issued", "type": "wallet", "currency": "USDC", "network": "base" }
```

Keep `data.id` as `SETTLEMENT_WALLET_ID`. It returned `ready` immediately. In live, refetch until `ready`.

### 7. Quote the pay-in

`POST /v3/quotes`

```json
{
  "customerId": "{CUSTOMER_ID}",
  "capabilityId": "{CAPABILITY_ID}",
  "externalId": "<your order id>",
  "in": { "amount": "150.00", "currency": "USD" },
  "destinationId": "{SETTLEMENT_WALLET_ID}",
  "out": { "currency": "USDC" }
}
```

Keep `data.id` as `QUOTE_ID`. Show the returned `out.amount` and `fees[]`. In the proof run a 150.00 USD pay-in quoted 149.25 USDC with a 0.75 USD fee. Never compute amounts yourself. The quote expires at `data.expiresAt`, 5 minutes after creation. Amounts below a Bank minimum return `422 amount_not_deliverable`.

### 8. Execute the quote

`POST /v3/transfers` with `{"quoteId":"{QUOTE_ID}"}` and a new idempotency key. Keep `data.id` as `TRANSFER_ID`. It returned `state: "awaiting_funds"`.

### 9. Fetch and show the payer instructions

`GET /v3/transfers/{TRANSFER_ID}/instructions` returns `data.transferId` and `data.instructions`. The instructions observed in sandbox had this shape (values are sandbox test data):

```json
{
  "type": "bank",
  "method": "ach",
  "amount": { "amount": "150.00", "currency": "USD" },
  "details": { "accountType": "checking", "accountNumber": "<account number>", "routingNumber": "<routing number>" },
  "bankName": "<bank name>",
  "accountHolderName": "<account holder>",
  "reference": { "value": "<reference>", "required": true }
}
```

Render the variant by `type` and do not assume a single shape. Card quotes return a hosted checkout instead of bank details. Show every returned field. When `reference.required` is true, show `reference.value` next to the bank details, make it copyable, and tell the payer the transfer will not match without it. These instructions belong to this transfer only, so never reuse them for another pay-in.

### 10. Wait for settlement

- **Sandbox:** `POST /v3/sandbox/transfers/{TRANSFER_ID}/state` with `{"state":"completed"}`, or `{"state":"failed","stateDetail":{"code":"sandbox_review","message":"..."}}` to test failure.
- **Live:** the payer sends the bank transfer. Wait for `transfer.state_changed`, then refetch.

`GET /v3/transfers/{TRANSFER_ID}`. The final state was `completed`, with `amounts.settled` at 149.25 USDC, and the settlement wallet's `balances[].available` showed the same amount.

## Sandbox-only shortcuts and their live replacements

| Sandbox call | What replaces it in live |
| --- | --- |
| Tester accepts the hosted terms page | End customer accepts it at `tosSessions[].action.url` |
| `POST /v3/sandbox/tasks/{id}/review` | Swipelux or Bank review. Wait for `capability.status_changed` / `application.status_changed` |
| `POST /v3/sandbox/customers/{id}/capabilities/{cap}/status` (optional, it does not clear tasks) | Bank approval |
| `POST /v3/sandbox/transfers/{id}/state` | The payer's real bank transfer arriving. Wait for `transfer.state_changed` |

## Polling rules

- Refetch on every relevant webhook, and poll as the fallback with backoff, for example 2 s, 5 s and 15 s, then every 60 s.
- Capability: poll until `ready` (continue), or `rejected` / `canceled` (stop). On `restricted` with `resolution: "complete_tasks"`, show the tasks again.
- Transfer: `awaiting_funds` can last days in live, so do not time it out on your side. `completed`, `failed` and `canceled` are terminal. Treat an unknown state as non-terminal. On `action_required` or non-empty `openTaskIds`, read `GET /v3/transfers/{id}/tasks`.
- Decide completion from `state`, not timestamps. `timestamps.completedAt` stayed `null` on a completed sandbox transfer.

## Webhook events

Register with `POST /v3/webhooks` (`url`, `events`), verify the Svix signature on the raw body, dedupe on the envelope `id`, return 2xx, then refetch the resource.

- `capability.status_changed`, `application.status_changed`: onboarding.
- `account.status_changed`: settlement wallet readiness.
- `transfer.created`, `transfer.state_changed`: pay-in progress and settlement.

## Gotchas observed

- The intake task always includes a hosted terms-of-service session that only the end customer can complete. Plan a UI step for it.
- Identity-document answers need `documentMetadata` (`idNumber`, `issuingCountry`). Without it the API returns `400 validation_error` at `/answers/N/answer`. Older OpenAPI copies do not list the field.
- `POST /v3/sandbox/tasks/{id}/review` returns `409 conflict` ("Task has no submitted submission to review") until you submit answers.
- The sandbox capability-status helper does not clear tasks. Accepting the task review alone made the capability `ready`.
- The transfer object also carries `instructions` on create. Still read `GET /v3/transfers/{id}/instructions` as the documented source and render from it.
- `externalId` on the quote is echoed back. Use it to tie the transfer to your order.
