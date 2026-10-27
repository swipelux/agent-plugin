---
name: swipelux-payments
description: Use when someone sends or receives money through Swipelux with this agent - recipients and destinations, rates, quotes, transfers, deposit instructions, transfer status or cancellation.
---

# Swipelux payments

Money moves in two steps: a **quote** fixes amounts, fees and rate until it expires; a **transfer** executes a quote.

## Recipients

`create_recipient`, then `add_recipient_destination` for each bank account or wallet. `list_recipients`, `list_recipient_destinations` to reuse existing ones.

## Send

1. `get_rate` for an indicative rate if the person asks.
2. `create_quote` with source, destination and amount. Show the person the amounts, fees and expiry from the result.
3. Only after the person confirms: `create_transfer` with the quote id. This moves real money in live spaces. If the quote expired meanwhile, create a new quote and confirm again.
4. Track with `get_transfer`; list with `list_transfers`.
5. `cancel_transfer` only on explicit request and only while the transfer allows it.

## Receive

- Named account: its bank details come from `get_account`; the payer sends to them directly.
- One-off pay-in: `create_quote` for the incoming amount, `create_transfer` with that quote, then `get_transfer_instructions` with the transfer id. It returns what the payer needs (bank details and reference). Pass the reference along exactly as returned. Payout transfers have no instructions.

## Rules

- Always confirm a live transfer with the person before `create_transfer`, restating amount, destination and fees.
- Write tools take an `idempotency_key` you generate. After a timeout or 5xx, retry `create_transfer` with the same key; never create a second transfer to retry one whose result you did not see. After a 4xx, fix the input and use a new key.
- If a transfer has Tasks (`list_transfer_tasks`), use the `swipelux-compliance` skill.
