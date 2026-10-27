# Use case: payouts (wallet to a third-party bank account)

**Outcome.** The developer's backend can send money from a customer's Swipelux wallet to a bank account owned by someone else (a contractor, supplier or payee). The customer holds USDC in an issued wallet. The backend registers the payee as a recipient with a bank destination, prices the payout with a quote, executes it as a transfer, and follows the transfer until it is `completed` or `failed`. This sequence was run end to end in sandbox on 2026-10-23 with an individual customer and the `ach_pooled` capability.

## Conventions for every call

- Base URL `https://platform.swipelux.com`. Send header `X-API-Key` from server-side config. Never expose the key to a browser.
- Every POST, PUT, PATCH and DELETE needs an `Idempotency-Key` header. Generate one new UUID per intended operation and store it with your local record before you send the request.
  - On a timeout or 5xx, retry with the same key and the same body.
  - On a 4xx, the key is spent: Swipelux replays the same error for that key. Fix the input, then send a new key.
- Responses wrap the resource in `data`. Errors are problem+json documents with `code`, `detail` and, for validation errors, `errors[].pointer`.
- Unknown query parameters are rejected with `400 unknown_parameter`. Send only documented filters.
- Persist every returned id (`cus_`, `tsk_`, `acc_`, `rcp_`, `dst_`, `quo_`, `tr_`) next to your own record.

## Call sequence

### 1. Create the customer

`POST /v3/customers`

```json
{
  "type": "individual",
  "externalId": "<your user id>",
  "individual": {
    "firstName": "Amina",
    "lastName": "Diallo",
    "email": "amina@example.com",
    "phone": "+14155551234",
    "birthDate": "1990-04-12",
    "residenceCountry": "US",
    "residentialAddress": {
      "streetLine1": "1 Market Street",
      "city": "San Francisco",
      "state": "CA",
      "postalCode": "94105",
      "country": "US"
    },
    "taxIdentifiers": [{ "type": "ssn", "country": "US", "value": "123456789" }],
    "identityDocuments": [{ "type": "passport", "issuingCountry": "US", "number": "X12345678", "expiresOn": "2031-01-01" }]
  },
  "financialProfile": { "accountPurposes": ["personal_expenses"] }
}
```

Keep `data.id` as `CUSTOMER_ID`. Only `type` is required. Sending the profile you already hold up front means the onboarding task in step 4 asks only for what is still missing. A minimal `{"type":"individual"}` customer works too, but the task then has 13 requirements instead of 2.

### 2. Upload the customer's documents (multipart)

`POST /v3/customers/{CUSTOMER_ID}/documents` as `multipart/form-data` with a `file` part (raw JPEG, PNG or PDF bytes, not base64) and a `type` part. Upload `passport_front` and `selfie` before you request the capability. Keep each `data.id` (`doc_...`).

When a document's `type` matches an open requirement, Swipelux reuses it and moves that requirement to `in_review` without a submission. This worked for `selfie`. It does not work for the identity document, which needs ID-number metadata in a submission (step 4).

### 3. Pick and request a payout capability

`GET /v3/customers/{CUSTOMER_ID}/capabilities/supported`. Choose an entry whose `directions` contains `payout`, whose `availability` is `available` or `beta`, and whose `eligibility.eligible` is `true`. Prefer `accountType: "pooled"` for payouts. Keep its `id` as `CAPABILITY_ID`, for example `ach_pooled`. Never hardcode a capability id. Read it from this response.

`POST /v3/customers/{CUSTOMER_ID}/capabilities/{CAPABILITY_ID}` with body `{}`. Omit `institutions` unless the person chose a Bank from the supported response.

The response is `201` (new application) or `200` (reused an existing one). Keep `data.status` and `data.openTaskIds`. A fresh customer gets `status: "restricted"` with `statusReason.code: "tasks_due"` and one intake task id.

### 4. Complete the onboarding task

`GET /v3/customers/{CUSTOMER_ID}/tasks/{TASK_ID}`. Read `revision`, `requirements[]` (only those with `status: "action_required"` need answers), `tosSessions[]`, `verificationSessions[]` and `completionPolicy`.

Completion needs both of these:

- **Requirements:** either answer every `action_required` requirement through the API, or send the customer through the hosted `verificationSessions[].action.url`.
- **Terms:** every entry in `tosSessions[]` must be `completed`. This is a hosted page at `tosSessions[].action.url` that the end customer opens and accepts. There is no API answer for it. Show it to the customer, then refetch the task.

Answer through the API with `POST /v3/customers/{CUSTOMER_ID}/tasks/{TASK_ID}/submissions`:

```json
{
  "taskRevision": 2,
  "answers": [
    {
      "requirementId": "req_...",
      "answer": {
        "type": "document",
        "documentIds": ["doc_<passport_front>"],
        "documentMetadata": [
          { "documentId": "doc_<passport_front>", "idNumber": "X12345678", "issuingCountry": "US" }
        ]
      }
    }
  ]
}
```

Use these answer shapes, each taken from the requirement's `request`:
- `request.type: "profile"`: `{"type":"profile","value": <value matching request.valueSchema>}`. Arrays use values from `allowedValues`.
- `request.type: "document"`: `{"type":"document","documentIds":[...]}`. When `request.constraints.identityMetadataRequired` is true, also send `documentMetadata` with `idNumber` and `issuingCountry` for every document. Without it the API returns `400 validation_error` at `/answers/N/answer`.
- A requirement with `allowsAbsence: true` can be answered `{"type":"absence","reason":"not_applicable"}`.

A minimal individual requested `ach_pooled` with no profile and had to answer these: account purposes, account-purpose description (absence allowed), identity document, birth date, email, first name, last name, identity-document metadata, phone, residence country, residential address, tax identifiers and selfie. With the profile prefilled as in step 1, only the identity document and the selfie remained.

The submission returns `201` with `outcome: "in_review"`. In live, a reviewer at Swipelux or the Bank decides. Wait for `capability.status_changed` or `application.status_changed`, then refetch.

### 5. (Sandbox only) Accept the review and confirm readiness

- `POST /v3/sandbox/tasks/{TASK_ID}/review` with `{"outcome":"accepted"}`. The task becomes `satisfied`. This returns `409 conflict` ("Task has no submitted submission to review") if you have not submitted answers yet.
- Optional: `POST /v3/sandbox/customers/{CUSTOMER_ID}/capabilities/{CAPABILITY_ID}/status` with `{"status":"ready"}`. It forces the Bank application to ready, but it **does not clear open customer tasks**. With the task still open, the call returned `200` while the capability stayed `restricted / tasks_due`. In the proof runs the capability became `ready` once the task was accepted, without this helper.
- `POST /v3/sandbox/customers/{CUSTOMER_ID}/verification` with `{"status":"approved"}` returned `200` but changed nothing on the capability. You do not need it for this flow.

Refetch `GET /v3/customers/{CUSTOMER_ID}/capabilities/{CAPABILITY_ID}`. Continue only when `data.status` is `ready` and `openTaskIds` is empty.

### 6. Get or create the source wallet

`GET /v3/customers/{CUSTOMER_ID}/accounts?origin=issued&type=wallet`. Reuse a `ready` USDC wallet if one exists. Do not filter by `currency` in the query: that returns `400 unknown_parameter`. Filter in your code instead.

Otherwise `POST /v3/customers/{CUSTOMER_ID}/accounts`:

```json
{ "origin": "issued", "type": "wallet", "currency": "USDC", "network": "base" }
```

Keep `data.id` as `SOURCE_WALLET_ID`. In sandbox the wallet came back `ready` with `details.address` immediately. In live, refetch until `status` is `ready`.

### 7. Fund the wallet

- **Sandbox:** `POST /v3/sandbox/accounts/{SOURCE_WALLET_ID}/topup` with `{"amount":"250.00","currency":"USDC"}`. It returns a completed transfer (`tr_...`), and the wallet's `balances[].available` updates at once.
- **Live:** the customer deposits USDC to `details.address`, or funds arrive from a pay-in. Before you quote, check `GET /v3/customers/{CUSTOMER_ID}/accounts/{SOURCE_WALLET_ID}` and confirm that `balances[]` (`currency`, `available`) covers the payout.

### 8. Create the recipient

`POST /v3/customers/{CUSTOMER_ID}/recipients`

```json
{
  "type": "individual",
  "relationship": "contractor",
  "firstName": "Jason",
  "lastName": "Payee",
  "email": "jason@example.com",
  "address": { "streetLine1": "1 Market Street", "city": "San Francisco", "state": "CA", "postalCode": "94105", "country": "US" }
}
```

Keep `data.id` as `RECIPIENT_ID`. It returned `status: "active"`. Include the address before you add a fiat destination. Take `relationship` from the request schema enum.

### 9. Create the destination

`POST /v3/customers/{CUSTOMER_ID}/recipients/{RECIPIENT_ID}/destinations`

```json
{
  "type": "ach",
  "currency": "USD",
  "details": {
    "routingNumber": "021000021",
    "accountNumber": "123456789",
    "accountType": "checking",
    "bankName": "Example Bank",
    "accountHolderName": "Jason Payee",
    "country": "US"
  }
}
```

Keep `data.id` as `DESTINATION_ID` (`dst_...`). It returned `status: "ready"` in sandbox. In live, read `GET .../destinations/{DESTINATION_ID}` and continue only when `status` permits payouts. Routing numbers, IBANs and BICs are checksum-validated, and a malformed value returns `400 validation_error`.

For a crypto wallet destination, send `type: "wallet"` with `details.network` and `details.address`, plus a required `ownership` object: `{ "type": "self_custodied" }` or `{ "type": "custodial" }`. Omitting `ownership` returns `400 validation_error` at `/ownership`. The destination network must match the source wallet's network, or the quote returns `422 recipient_destination_invalid` (`network_mismatch`).

If the customer owns the receiving account instead, skip steps 8 and 9. Create an external account with `POST /v3/customers/{CUSTOMER_ID}/accounts` and body `{"origin":"external","type":"bank","methods":["ach"],"country":"US","currency":"USD","details":{...}}`, then use its `acc_` id as the destination. This path comes from the public docs and was not exercised in the proof run.

### 10. Quote the payout

`POST /v3/quotes`

```json
{
  "customerId": "{CUSTOMER_ID}",
  "capabilityId": "{CAPABILITY_ID}",
  "in": { "amount": "150.00", "currency": "USDC", "accountId": "{SOURCE_WALLET_ID}" },
  "destinationId": "{DESTINATION_ID}",
  "out": { "currency": "USD" }
}
```

Keep `data.id` as `QUOTE_ID`. Show `data.out.amount`, `data.rate` and `data.fees[]` to the user exactly as returned. Do not recompute them. The quote expires at `data.expiresAt`, 5 minutes after creation in the proof run. Use the `dst_` id as `destinationId`, never the `rcp_` id.

### 11. Execute the payout

`POST /v3/transfers` with `{"quoteId":"{QUOTE_ID}"}` and a new idempotency key. Keep `data.id` as `TRANSFER_ID`. The transfer returned `state: "processing"` with `stateDetail.code: "security_review_pending"`. A created transfer means the payout started. It does not mean the payout was delivered.

### 12. Drive or wait for the outcome

- **Sandbox:** `POST /v3/sandbox/transfers/{TRANSFER_ID}/state` with `{"state":"completed"}`, or `{"state":"failed"}` to test failure handling.
- **Live:** wait for `transfer.state_changed`, then refetch.

`GET /v3/transfers/{TRANSFER_ID}`. The final state in the proof run was `completed`, with `amounts.settled` populated and the wallet's available balance down by the payout amount.

## Sandbox-only shortcuts and their live replacements

| Sandbox call | What replaces it in live |
| --- | --- |
| Hosted terms page accepted by the tester | The end customer accepts it at `tosSessions[].action.url` |
| `POST /v3/sandbox/tasks/{id}/review` | Swipelux or Bank review. Wait for `application.status_changed` / `capability.status_changed`, refetch, and handle returned requirements |
| `POST /v3/sandbox/customers/{id}/capabilities/{cap}/status` | Bank approval. Same webhooks |
| `POST /v3/sandbox/customers/{id}/verification` | Not needed. There is no live equivalent call |
| `POST /v3/sandbox/accounts/{id}/topup` | Real USDC deposit to the wallet address, or a completed pay-in |
| `POST /v3/sandbox/transfers/{id}/state` | Bank execution. Wait for `transfer.state_changed` |

## Polling rules

- Treat webhooks as triggers to refetch, and keep polling as the fallback. Poll a non-terminal resource with backoff, for example 2 s, 5 s and 15 s, then every 60 s. Stop at a terminal state.
- Capability: stop polling when `status` is `ready`, `rejected` or `canceled`. On `restricted` with `statusReason.resolution: "complete_tasks"`, refetch `openTaskIds` and show the tasks again.
- Task: refetch right before each submission. If the API says the revision changed, rebuild the answers from the new `revision`.
- Transfer: `completed`, `failed` and `canceled` are terminal. `awaiting_funds`, `processing` and `action_required` are not. Treat an unknown state as non-terminal. On `action_required` or non-empty `openTaskIds`, read `GET /v3/transfers/{id}/tasks`.
- Do not use `timestamps.completedAt` to detect completion. It stayed `null` on a completed sandbox transfer. Use `state`.

## Webhook events

Subscribe with `POST /v3/webhooks` (`url`, `events`), verify the Svix signature on the raw body, store the event id under a unique constraint, return 2xx, then refetch the resource named in `resource.type` / `resource.id`.

- `capability.status_changed`, `application.status_changed`: onboarding progress.
- `recipient.status_changed`, `destination.status_changed`: payee readiness.
- `account.status_changed`: source wallet readiness.
- `transfer.created`, `transfer.state_changed`: payout progress and outcome.

The catalogue has no task event. Task changes show up as capability or application changes, so refetch tasks then.

## Gotchas observed

- The sandbox capability-status helper does not clear open tasks. The capability stays `restricted / tasks_due` until the intake task is submitted, its terms are accepted and the task is reviewed.
- Every intake task includes a hosted terms-of-service session. The API cannot complete it, so your UI must send the end customer to the link.
- Identity-document answers need `documentMetadata` with `idNumber` and `issuingCountry` for each document. Older copies of the OpenAPI spec omit this field. Follow the live API.
- Uploading documents with the correct `type` before requesting the capability auto-satisfies matching document requirements, except the identity document.
- `GET /v3/capabilities` lists capability records across all of your customers. It is not a catalogue. Use `GET /v3/customers/{id}/capabilities/supported` to choose.
- The customer resource has no verification status. Readiness comes only from capabilities and their tasks.
- A new payout first showed `processing / security_review_pending`. That is normal and not an error.
