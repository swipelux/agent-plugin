# Use case: issue a bank account (reusable bank details settling to a wallet)

**Outcome.** The developer's backend can give a customer their own reusable bank details, for example a US ACH account number and routing number. Anyone can send funds to these details at any time. Deposits settle automatically as stablecoin into the customer's Swipelux wallet. The backend gets a named-account capability ready, creates an issued bank account linked to a settlement wallet, and shows the details once the account reports them. This sequence was run end to end in sandbox on 2026-10-23 with an individual customer and the `ach_named` capability.

For a one-time, fixed-amount pay-in, use `receive-funds.md` instead.

## Conventions for every call

- Base URL `https://platform.swipelux.com`. Send header `X-API-Key` from server-side config only.
- Every POST, PUT, PATCH and DELETE needs an `Idempotency-Key` header. Use one new UUID per intended operation and persist it before sending. On a timeout or 5xx, retry with the same key and body. On a 4xx the key is spent: fix the input and use a new key.
- Responses wrap the resource in `data`. Errors are problem+json with `code`, `detail` and `errors[].pointer`.
- Unknown query parameters return `400 unknown_parameter`.

## Call sequence

### 1. Create the customer

`POST /v3/customers`. Prefill what you know so the intake task asks for less:

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
    "identityDocuments": [{ "type": "passport", "issuingCountry": "US", "number": "X12345678", "expiresOn": "2031-01-01" }],
    "employment": { "status": "employed", "occupation": "Software engineer" }
  },
  "financialProfile": {
    "accountPurposes": ["personal_expenses"],
    "estimatedAnnualRevenue": { "amount": "85000", "currency": "USD" },
    "sourcesOfFunds": ["salary"],
    "sourcesOfWealth": ["employment_income"]
  }
}
```

Keep `data.id` as `CUSTOMER_ID`. The proof run created the customer without the `employment` and the last three `financialProfile` fields and answered them in the task instead (step 4). A separate sandbox check confirmed that `POST /v3/customers` accepts and stores those fields. Prefilling them should remove those requirements from the task, but the proof run did not exercise that.

### 2. Upload documents (multipart)

`POST /v3/customers/{CUSTOMER_ID}/documents` as `multipart/form-data` with a `file` part (raw bytes, not base64) and a `type` part. A named capability asked for more evidence than a pooled one:

| `type` to upload | Satisfies requirement | Reused automatically? |
| --- | --- | --- |
| `passport_front` | `identity_document` | No. Answer it in a submission with `documentMetadata` |
| `selfie` | `selfie` | Yes |
| `bank_statement` (or `tax_return`, `employment_contract`) | `named_source_of_funds_document` | Yes |
| `utility_bill` (or `proof_of_address`, `bank_statement`, `rental_agreement`, `tax_document`, `government_correspondence`) | `proof_of_address` | Yes |

Keep each `doc_` id. Proof of address is limited to 3,000,000 bytes.

### 3. Pick and request a named capability

`GET /v3/customers/{CUSTOMER_ID}/capabilities/supported`. Choose an entry with `accountType: "named"`, the needed `method` (for example `ach`), `availability` of `available` or `beta`, and `eligibility.eligible: true`. Keep its `id` as `CAPABILITY_ID`, for example `ach_named`. Named capabilities are the only ones that issue reusable details. Use `swift_named` for SWIFT deposits. Many named methods show `availability: "disabled"`, so always read this list rather than assuming.

`POST /v3/customers/{CUSTOMER_ID}/capabilities/{CAPABILITY_ID}` with `{}`. To pin a Bank, send `{"institutions":["<id from the supported response>"]}`. In sandbox, ACH, Wire and SWIFT accept only the single institution the supported response lists. The call returns `201`, a top-level `selectedApplicationId`, `status: "restricted"`, `statusReason.code: "tasks_due"`, `accountProvisioning: "not_started"` and one intake task id.

### 4. Complete the onboarding task

`GET /v3/customers/{CUSTOMER_ID}/tasks/{TASK_ID}`. With the profile from the proof run (step 1 without employment and the last three financial fields) and the four uploads, these were still `action_required`:

- `financial_profile_estimated_annual_revenue`: object `{amount, currency:"USD"}`
- `financial_profile_sources_of_funds`: array of exactly 1 value from `allowedValues` (`valueSchema.maxItems` is 1)
- `financial_profile_sources_of_wealth`: array of exactly 1 value from `allowedValues`
- `individual_employment`: object with required `occupation`
- `identity_document`: document plus metadata

The task also has one `tosSessions[]` entry, a hosted terms page the end customer must accept at `action.url`. The task cannot complete until it is `completed`.

`POST /v3/customers/{CUSTOMER_ID}/tasks/{TASK_ID}/submissions`:

```json
{
  "taskRevision": 3,
  "answers": [
    { "requirementId": "req_<estimated_annual_revenue>", "answer": { "type": "profile", "value": { "amount": "85000", "currency": "USD" } } },
    { "requirementId": "req_<sources_of_funds>", "answer": { "type": "profile", "value": ["salary"] } },
    { "requirementId": "req_<sources_of_wealth>", "answer": { "type": "profile", "value": ["employment_income"] } },
    { "requirementId": "req_<employment>", "answer": { "type": "profile", "value": { "status": "employed", "occupation": "Software engineer" } } },
    { "requirementId": "req_<identity_document>", "answer": { "type": "document", "documentIds": ["doc_<passport_front>"], "documentMetadata": [{ "documentId": "doc_<passport_front>", "idNumber": "X12345678", "issuingCountry": "US" }] } }
  ]
}
```

The task `revision` increases after each upload, so read the task right before you submit. The call returns `201` with `outcome: "in_review"`.

### 5. (Sandbox only) Accept the review

`POST /v3/sandbox/tasks/{TASK_ID}/review` with `{"outcome":"accepted"}`. The task becomes `satisfied`. `GET /v3/customers/{CUSTOMER_ID}/capabilities/{CAPABILITY_ID}` then returned `ready`, `openTaskIds: []` and `accountProvisioning: "not_started"`, without the capability-status force helper. Continue only on `ready`, unless you deliberately use `allowPending` (see the gotchas).

### 6. Get or create the settlement wallet

`GET /v3/customers/{CUSTOMER_ID}/accounts?origin=issued&type=wallet`. Reuse a `ready` wallet. Otherwise `POST /v3/customers/{CUSTOMER_ID}/accounts`:

```json
{ "origin": "issued", "type": "wallet", "currency": "USDC", "network": "base" }
```

Keep `data.id` as `SETTLEMENT_WALLET_ID`. The settlement target must be an issued wallet, not an external one.

### 7. Create the issued bank account

`POST /v3/customers/{CUSTOMER_ID}/accounts`

```json
{
  "origin": "issued",
  "type": "bank",
  "method": "ach",
  "country": "US",
  "currency": "USD",
  "settlement": { "accountId": "{SETTLEMENT_WALLET_ID}" }
}
```

Keep `data.id` as `BANK_ACCOUNT_ID`, plus `data.status`, `data.openTaskIds` and `data.details`. In sandbox the response was already `status: "ready"` with full `details`, and `capabilityId: "ach_named"`, `accountType: "named"`, `institution` and `settlement.accountId` were echoed. Optional fields: `label`, `institution` (pin one Bank), `allowPending: true` (requires `institution`), and `settlement.currency` (`USDC` or `USDT`).

### 8. Read and show the bank details

`GET /v3/customers/{CUSTOMER_ID}/accounts/{BANK_ACCOUNT_ID}`. The details observed in sandbox had this shape (values are sandbox test data):

```json
{
  "status": "ready",
  "details": {
    "routingNumber": "<routing number>",
    "accountNumber": "<account number>",
    "accountType": "checking",
    "bankName": "<bank name>",
    "accountHolderName": "<account holder>",
    "reference": "<reference>",
    "referenceRequired": true
  }
}
```

Show only what the latest read returns, and never placeholders. When `details.referenceRequired` is true, show `details.reference` next to the details as copyable, and tell payers to include it. For SWIFT, also show `swiftCode`, `bankAddress`, `accountHolderAddress` and any intermediary fields when they are returned. After creation the capability reported `accountProvisioning: "issued"`.

Deposits to these details settle into `SETTLEMENT_WALLET_ID` and show up as transfers. List them with `GET /v3/transfers?accountId={SETTLEMENT_WALLET_ID}`.

## Sandbox-only shortcuts and their live replacements

| Sandbox call | What replaces it in live |
| --- | --- |
| Tester accepts the hosted terms page | End customer accepts it at `tosSessions[].action.url` |
| `POST /v3/sandbox/tasks/{id}/review` | Swipelux and Bank review of the named application. This can take days and can return requirements for correction |
| `POST /v3/sandbox/customers/{id}/capabilities/{cap}/status` (optional, it does not clear tasks) | Bank approval. Wait for `application.status_changed` / `capability.status_changed` |
| Immediate `ready` account with details | Account starts in provisioning. Wait for `account.status_changed` / `account.details_changed` |

## Polling rules

- Refetch on each webhook, and poll as the fallback with backoff, for example 2 s, 5 s and 15 s, then every 60 s.
- Capability: wait for `ready`, and stop on `rejected` / `canceled`. For named capabilities, also read `accountProvisioning`: `not_started`, `in_progress`, `issued` or `failed`.
- Account: keep the UI pending while `details` is absent or `status` is `provisioning` / `in_review`. If `openTaskIds` is non-empty, show those tasks. If `statusReason.code` is `awaiting_assignment`, create the first pay-in for the same customer, capability and settlement wallet (see `receive-funds.md`), then read the account again. Stop on `rejected`, `suspended` or `archived`.
- Do not infer readiness from elapsed time.

## Webhook events

Register with `POST /v3/webhooks` (`url`, `events`), verify the Svix signature on the raw body, dedupe on the envelope `id`, return 2xx, then refetch.

- `capability.status_changed`, `application.status_changed`: named application review.
- `account.created`, `account.status_changed`, `account.details_changed`: provisioning, and the moment details become available or change.
- `transfer.created`, `transfer.state_changed`: incoming deposits to the issued details.

## Gotchas observed

- Named capabilities ask for more than pooled ones: estimated annual revenue, a single source of funds, a single source of wealth, occupation, a source-of-funds document and a proof-of-address document, on top of identity, selfie and terms.
- `sourcesOfFunds` and `sourcesOfWealth` accept exactly one value in this flow (`maxItems: 1`), even though they are arrays.
- Identity-document answers need `documentMetadata` (`idNumber`, `issuingCountry`) for every document, or the API returns `400 validation_error`. Older OpenAPI copies omit the field.
- The sandbox capability-status helper does not clear open tasks. The task must be submitted, its terms accepted and then reviewed.
- One issued account is allowed per customer, method, currency and Bank. A second request without `institution` returns `409 conflict` if one already exists, so read the existing account instead.
- `allowPending: true` with `institution` lets you create the account before the Bank approves. It then sits at `in_review` with `statusReason.code: "waiting_for_approval"` and later gets details under the same id. Not exercised in this proof.
- Many named methods (for example SEPA) are `disabled` in the supported list. Check before you promise a currency.
