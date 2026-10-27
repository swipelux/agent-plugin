---
name: swipelux-compliance
description: Use when a compliance or operations person works Swipelux Tasks - finding what a Bank still needs from a customer, uploading documents, submitting Task answers, or checking review status.
---

# Swipelux Tasks and documents

A Task is a request for information or documents from a Bank or from Swipelux, about one customer (or one transfer). The customer's capability cannot become active until its required Tasks are accepted.

## Find work

- All open Tasks in the space: `list_tasks`; one by id: `get_task`.
- One customer's Tasks: `list_customer_tasks`; details and what each item needs: `get_customer_task`.
- What happened so far: `list_task_history`, `list_task_submissions`, `get_task_submission`.
- Transfer-scoped Tasks: `list_transfer_tasks`.

## Answer a Task

1. Read the Task with `get_customer_task`. Each item says what is needed, why, and how it can be answered (its allowed submission channels).
2. Identity verification items (channel `verification_session`) are answered by the person, not by uploads: give them the session link from `get_customer_task`. If they already passed identity verification with another business, `import_verification_share_token` imports it. Do not upload ID scans for these items.
3. Existing documents first: `list_customer_documents`, `get_customer_document`, `download_customer_document`. Reuse one instead of asking again.
4. New documents: call `create_document_upload_link` with the customer id and the document type the item asks for. One link takes one file, lasts 15 minutes, and accepts up to 4 MB (the item's own size limit may be lower).
   - Person uploads through the page: wait until they say it is done, then find the new document with `list_customer_documents`.
   - Terminal agent with the file on disk: run the returned `curl` command; its result is the new document with its id.
5. Submit everything for the Task in one `create_task_submission`, referencing document ids and answers as `get_customer_task` describes. Check field names in `swipelux-docs` if unsure.
6. Track: `get_customer_task` shows the Task status (`action_required` or `in_review` while open) and any returned items with reasons.

`withdraw_task_submission` pulls back a submission that is still in review; confirm with the person first.

## Rules

- Never invent answers or documents. Ask the person for anything you do not have.
- Do not paste document contents into chat; use the upload link.
- Refer to reviewers as the Bank or Swipelux compliance, never by any other name.
