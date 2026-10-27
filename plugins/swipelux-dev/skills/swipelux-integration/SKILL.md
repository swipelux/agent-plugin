---
name: swipelux-integration
description: Use when a developer builds or debugs a Swipelux integration with this agent - creating customers, requesting capabilities, issuing accounts, setting up webhooks, or testing flows in sandbox.
---

# Building on Swipelux API v3

The `swipelux` tools map one-to-one to API v3 operations in the space chosen at connection. Check request fields with `swipelux-docs` before calling a write tool you have not used in this session.

## Build path

1. **Customer.** `create_customer`, then `get_customer`. Individuals and businesses both start here; business owners and directors are related parties (`create_related_party`, `list_related_parties`).
2. **Capabilities.** `list_merchant_capabilities` shows what your space offers. `list_supported_capabilities` shows what one customer can request; `preview_capability_tasks` shows what a Bank will ask for. `request_capability` starts it; `get_capability`, `list_customer_capabilities` and `list_customer_applications` track progress.
3. **Tasks.** Open Tasks are what a Bank still needs. Hand compliance work to the `swipelux-compliance` skill.
4. **Accounts.** Once a capability is active: `create_account`, `list_accounts`, `get_account`. Account fees: `get_account_fees`, `replace_account_fees`.
5. **Money movement.** Hand to the `swipelux-payments` skill.
6. **Webhooks.** `create_webhook`, `list_webhooks`; `get_webhook_portal_url` opens delivery logs.

## Sandbox

Sandbox tools (`sandbox_*`) only work in sandbox spaces; a live space answers 403.
- `sandbox_set_customer_verification` and `sandbox_set_capability_status` move onboarding forward without waiting for a Bank.
- `sandbox_create_task` and `sandbox_review_task` exercise the Task flow.
- `sandbox_topup_account` funds an account; `sandbox_set_transfer_state` drives a transfer to any state.

## Rules

- Write tools require `idempotency_key`. Generate a new UUID for each operation.
  - Timeout or 5xx: retry with the same key and the same input.
  - 4xx: the key is spent; Swipelux replays the same error for it. Fix the input, then retry with a new key.
- A 403 names the missing permission. Tell the person; they can connect again with that permission, or an admin can grant it.
- Archive tools (`archive_*`) and cancel tools are destructive: confirm with the person first.
