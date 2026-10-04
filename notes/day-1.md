# Day 1: Kubernetes keeps things running

## What Kubernetes does, in my words

Kubernetes stores a record of what I want (for example, "1 hello pod") in
etcd, which is a database. A controller keeps checking what is actually
running. If there is a mismatch, Kubernetes creates or deletes pods until
reality matches the record.

The machines don't negotiate with each other. The "agreeing" happens inside
etcd, which uses the Raft consensus algorithm so its copies agree on the record.

## Experiment A: kill a pod

- Before: `hello-6957c55654-wvzzp`
- I ran `kubectl delete pod -l app=hello`
- After: `hello-6957c55654-kbl75`, a new pod I never asked for

Kubernetes did not revive the old pod. It created a new one from the same
blueprint. Pods are disposable.

## Experiment B: change desired state

- Changed `replicas: 1` to `replicas: 3` and ran `kubectl apply`
- `kbl75` stayed, and two new pods appeared (`8ft59`, `kv99q`)
- Running `apply` again said `unchanged`: apply means "make the cluster match
  this file", not "do an action". It is idempotent.

## Step 2: does seat A1 survive Postgres being killed?

My prediction: without a disk the data dies with the pod; with a disk it
survives, because the data lives outside the pod.

Setup: two Postgres instances, both loaded with `setup.sql` from Last Seat Lab.

| | With disk (StatefulSet) | Without disk (Deployment) |
|---|---|---|
| Book A1 | `UPDATE 1` | `UPDATE 1` |
| Kill the pod | came back as `postgres-0` (same name) | came back as `...-jwk4w` (new name, was `...-j5qcm`) |
| Pod status after | `1/1 Running` | `1/1 Running` |
| `SELECT * FROM seats` | `A1 | ullas` | `ERROR: relation "seats" does not exist` |

Both predictions were right, but the no-disk result was worse than "the
booking is gone": the whole table was gone. The new pod found an empty data
directory and created a fresh database.

The StatefulSet pod kept the name `postgres-0`, so Kubernetes reattached it to
the same disk (`data-postgres-0`). Postgres read its data directory and WAL and
the committed booking was still there.

## The big lesson

Kubernetes reported the empty database as `1/1 Running`, perfectly healthy.
Kubernetes guarantees the process is running. It does not guarantee my data
is correct. Durability comes from the disk and the database, not Kubernetes.

## What surprised me

I never knew Kubernetes manages servers for you, so that was nice. And the disk
thing was nice: the data is stored on the disk rather than dying with the pods.

## Next question

Three seat servers racing for A1 at the same time, while Kubernetes kills
some of them mid-request. Does exactly one person still win?
