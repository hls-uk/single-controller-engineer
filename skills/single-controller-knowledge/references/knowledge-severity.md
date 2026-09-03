# Knowledge severity

The accelerated-beta severity definitions apply unchanged; read
[the accelerated-beta reference](../../single-controller-engineer/references/accelerated-beta.md)
for tiers, gates, and compact evidence. These are the knowledge examples that
bind them. Severity is decided by user impact and authority risk, not by how
interesting the defect is.

| Severity | Knowledge examples                                                                                                                                                                                                                                                    | Effect               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| P0       | Management content in an operations repository, worktree, view, or Drive output; a credential in Git or a Drive output; any overwrite, deletion, or reverse sync of Drive content; a lost or altered provenance record; two editable canonical copies of one artifact | Blocks immediately   |
| P1       | A page contradicting an accepted decision without supersession; a broken canonical link or missing successor in a promised page; a deliverable claim the cited sources do not support; materialisation to the wrong destination or alias; a stale base landed         | Blocks the candidate |
| P2       | Audience or clarity defects with a workaround; incomplete rollup polish; a non-core generated view out of date; a missing optional source citation                                                                                                                    | Recorded, continues  |
| P3       | Wording, ordering, formatting preferences, optimisation                                                                                                                                                                                                               | Deferred             |

## Reviewer charge

Every frozen candidate receives a fresh frontier review bound to its exact
base and head. The reviewer reproduces the candidate diff in the unit's
read-only worktree with the packet's canonical command, checks the digest,
and then judges, in this order:

1. access-boundary leakage into the wrong audience, worktree, view, or Drive;
2. contradiction with an accepted decision or page that is not explicitly
   superseded;
3. provenance or supersession errors;
4. factual claims in a promised deliverable that the cited sources do not
   support;
5. audience fit;
6. style.

The verdict is approve or request changes with actionable findings. A P0 or
P1 finding must name a concrete, reproducible violation of a promised path;
speculative edge cases, safe conservatism, and preferences are P2 or P3 and
are recorded as follow-up Beads rather than widening the wave.

## Roles and tiers

| Role            | Tier            | Responsibilities                                                                                                      |
| --------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Controller      | Frontier        | Decomposition, authority, semantic gates, materialisation and provenance effects, plain-language stops for the driver |
| Reviewer        | Frontier        | Fresh exact-pair verdict against the charge above                                                                     |
| Author          | Workhorse       | One bounded knowledge unit in one worktree                                                                            |
| Diagnostician   | Workhorse first | Explain changed verification failures and repair on the same identity                                                 |
| Mechanical step | Runtime         | Packets, verification binding, materialise, projection, readback                                                      |
| Human driver    | Person          | Objective, scope, exceptions, and every authority the profile does not grant                                          |

Where the harness family is classified `at-most-once-manual`, an ambiguous
author launch blocks for a human-bound observation; present that stop to the
driver as what was started, what could not be confirmed, and the one action
that resolves it.
