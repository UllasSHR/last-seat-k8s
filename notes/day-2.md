# Day 2: three servers race for one seat

## Warm-up: did A1 survive?

After 3 pod kills, a full `colima stop`, and 9+ hours switched off,
`postgres-0` still said `A1 | ullas`. No pod that ever ran is still alive, but
the booking is. The data belongs to the disk, not to any pod.

## What I built

- `seat-api/server.js`: an HTTP server with `POST /reserve`. I wrote
  `reserveSafe()`:

  ```js
  const result = await db.query(
    "UPDATE seats SET reserved_by = $1 WHERE seat_code = 'A1' AND reserved_by IS NULL",
    [name],
  );
  return result.rowCount > 0;
  ```

  Bug I hit first: I wrote `[Ullas]` instead of `[name]`. It passed a syntax
  check but would crash on every request, because `Ullas` is not a variable.
- `Dockerfile`: code -> image -> `kind load` -> 3 pods behind the `seat-api`
  Service.
- `race.js`: 200 people book A1 at the same moment, from inside the cluster.

## Experiment 1: my safe code, 200 people, 3 servers

| Pod | Requests |
|---|---|
| qj4hm | 71 |
| x5f2q | 63 |
| cb77l | 66 |

1 person told "you got the seat", and Postgres agreed (`user-0`). Three
separate servers, no shared memory. Postgres is the only shared thing and the
only referee.

## Experiment 2: the naive check-then-act code

`reserveNaive()` does `SELECT` (is it free?) and then `UPDATE` (no `IS NULL`).

- No delay: **1 winner**. The bug was there but the gap was too small to hit.
- `CHECK_DELAY_MS=50` (like calling a payment service between the steps):
  **17 people told "you got the seat!"**, Postgres only had `user-2`.
  16 people hold a confirmation for a seat they don't have (a lost update).
- My safe code with the same delay: **1 winner**. The delay lives between two
  trips, and my code only makes one trip.

Lesson: a race condition can pass every test and still be there. Neither
Postgres nor Kubernetes was at fault; the bug was how the code used the
database.

Kubernetes bonus: `kubectl set env` caused a rolling update. The pod name's
middle part changed (`86f459f6c6` -> `7554c5b5d7`, a fingerprint of the
blueprint), and new pods became Ready before old ones terminated: zero
downtime.

## Experiment 3: crash every server mid-request

Each server waits 10 s after booking (like sending a confirmation email)
before replying. 5 s into a 200-person race, I force-killed all 3 pods
(`--grace-period=0 --force`, like a power cut).

- Errors: **200** (`UND_ERR_SOCKET`, connection cut). Nobody was told they won.
- Postgres: `A1 -> user-2`. Still exactly one owner.
- What `user-2` saw: **an error**.
- Kubernetes replaced all 3 servers in about 11 seconds.

`user-2` owns the seat and doesn't know it. If they retry, my code says
"seat taken", so they believe they lost a seat they own.

Lesson: when a request fails, the client can't know whether the work happened.
A crash before the write and a crash after the write look identical from
outside. Kubernetes restarted everything perfectly, Postgres stored everything
perfectly, and the user still got the wrong answer.

## Review: what a Service is (in my words)

A Service spreads requests across all the pods. It is a Kubernetes feature
(not kind-specific), and it is also a stable name: `seat-api` stayed the same
while I killed pod `ntcbl` and its IP `10.244.0.7` was replaced by a new pod at
`10.244.0.10` in `kubectl get endpoints seat-api`. The Service's list is every
Ready pod with the label `app=seat-api`, kept up to date automatically.

## Review: watching the row lock (hop 4)

Alice ran `BEGIN; UPDATE ... IS NULL; pg_sleep(10); COMMIT/ROLLBACK`, holding
the A1 row lock for 10 s. At 2 s, bob ran something else:

| At 2s, bob runs... | Waited? | Bob's result |
|---|---|---|
| `UPDATE ... IS NULL`, alice commits | 8.3 s | `UPDATE 0` |
| `UPDATE ... IS NULL`, alice rolls back | 8.2 s | `UPDATE 1` |
| `SELECT` | 0.1 s | empty seat |

- An `UPDATE` waits for the row lock, then re-checks its `WHERE` against the
  latest committed row. That's why my safe code has exactly one winner.
- Bob waits even when alice will roll back: Postgres can't know the future.
- A `SELECT` never waits for writers. It shows the last committed version, so
  bob saw "free" while alice was mid-booking. That is the naive bug, isolated:
  the `SELECT` answer is already stale, and the later `UPDATE` (no `IS NULL`)
  never re-checks.

## Review: the crash (scenario 3), in my words

The pod is the connection to the `reserveSafe()` code: it runs it and carries
messages between the user and Postgres. Once the transaction is committed in
Postgres, it doesn't matter if the pod dies; the booking is permanent.

What the crash destroys is the reply. The booking lived in Postgres (safe);
the "you won" message lived only inside the pod (lost). I first mixed this up
with bob's stale `SELECT`: user-2 did NOT see an empty seat, they saw an error,
and they DID own A1.

## What surprised me

<!-- write this part yourself -->

## Next session

Make retries safe (idempotency): if `user-2` retries, the answer should be
"the seat is yours", not "taken". Change `reserveSafe()` so that "free" OR
"already mine" both count as a win. Then rerun the chaos experiment with
retries.
