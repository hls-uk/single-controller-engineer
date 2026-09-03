---
name: single-controller-feedback
description: Prepare or refine an explicit, privacy-bounded upstream report for single-controller-engineer. Use only when the user asks to report or improve feedback; not for automatic issue creation.
---

<!-- sce-skill-version: 0.1.0 -->

# Single-controller feedback

Use the sibling primary skill/runtime from the same installed set. Refuse a
missing sibling, invalid manifest, or version mismatch. This skill is explicit
only: observing a failure is not authority to contact the upstream project.

Classify whether the report is about the generic controller/runtime rather
than the consuming project's code or transient provider weather. Prepare and
preview locally using only the controlled telemetry contract. Show the fixed
repository name and immutable ID, generated title/body, fingerprint, marker,
and all narrative warnings. Narrative requires current-user approval of those
exact preview bytes; policy-safe telemetry can never authorize narrative.

Creating an issue, comment, attachment, retrying a submit intent, or flushing
an outbox packet is a separate external mutation requiring current exact
authority. On missing authority/connectivity, persist only the validated packet
to the consumer repository's Git-common-dir outbox and report that it was
queued—not sent. A prior ambiguous submit must be discovered by exact marker
before a fresh nonce can authorize another attempt.

Read [the feedback contract](references/feedback-contract.md) before handling
reports. Do not copy consuming-project source, arbitrary logs, credentials,
environment values, or absolute paths into feedback.
