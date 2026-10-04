# Day 3: making retries safe (idempotency)

## The problem from day 2

In the crash experiment, `user-2` owned A1 in Postgres but saw an error,
because the server died after committing and before replying. If `user-2`
retried, my code said "taken", so they'd believe they lost a seat they own.

## The fix: count "already mine" as a win

My first attempt:

```sql
WHERE seat_code = 'A1' AND reserved_by IS NULL OR reserved_by = $1
```

SQL evaluates `AND` before `OR`, so this means
`(A1 AND empty) OR (any row with my name)`. With one seat it looked fine.
With two seats (A1 = bob, A2 = alice), alice booking A1 gave `UPDATE 1`: it
"updated" A2 (alice -> alice), so `reserveSafe()` would tell her she won A1.

The fix is brackets:

```sql
UPDATE seats SET reserved_by = $1
WHERE seat_code = 'A1' AND (reserved_by IS NULL OR reserved_by = $1)
```

Tested every case in `psql`:

| Situation | Expected | Got |
|---|---|---|
| alice books A1 owned by bob (she owns A2) | 0 | 0 |
| bob retries A1 he owns | 1 | 1 |
| alice books empty A1 | 1 | 1 |
| alice retries A1 she owns | 1 | 1 |

Through the API, alice's retry landed on a different pod and still won: the
server doesn't need to remember anything because the truth lives in Postgres.

How to reason about it myself:
1. Say the rule in plain English with brackets: "A1 and (empty or mine)".
2. List every case, especially the ones that should fail.
3. Test with data that can break it (add a second seat).
4. Whenever `AND` and `OR` mix, always use brackets.

## Rerunning the crash, with retries

Same setup as day 2: 10 s delay after booking before replying, all 3 servers
force-killed 5 s in. New: idempotent `reserveSafe()` and users retry on error.

| | Day 2 (no fix) | Day 3 (idempotent + retry) |
|---|---|---|
| Errors in the end | 200 | 0 |
| People told "you got the seat!" | 0 | 1 |
| Postgres owner | user-2 | user-1 |
| What the owner saw | an error | "you got the seat!" (2nd attempt) |
| Anyone wrongly told they won? | no | no |

`user-1`'s first attempt committed, then the server died. Their retry reached a
brand-new server that had never heard of them; it asked Postgres, matched
`reserved_by = 'user-1'`, and replied "you got the seat!". The lost reply was
recovered from the database.

Pattern: crash -> retry -> idempotent operation -> correct answer.

Limit: we use the name as identity. Real systems use a user ID or an
idempotency key (a unique ID per click), so two different people with the same
name can't be treated as one.

## What surprised me

<!-- write this part yourself -->
