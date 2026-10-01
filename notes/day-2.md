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

## What surprised me

<!-- write this part yourself -->

## Next session

Make retries safe (idempotency): if `user-2` retries, the answer should be
"the seat is yours", not "taken". Change `reserveSafe()` so that "free" OR
"already mine" both count as a win. Then rerun the chaos experiment with
retries.
