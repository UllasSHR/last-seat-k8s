# Last Seat on Kubernetes

A learning lab that moves [Last Seat Lab](https://github.com/UllasSHR/last-seat-lab)
onto a local Kubernetes cluster. One seat (`A1`), many servers, and deliberate
failures, to see what Kubernetes guarantees and what it leaves to the database
and the code.

This is a learning and evidence repository, not a production system.

## What is here

- `k8s/` — manifests:
  - `01-hello.yaml`: first Deployment and Service (kill and scale experiments)
  - `02-postgres.yaml`: PostgreSQL as a StatefulSet with a persistent volume
  - `02b-postgres-no-volume.yaml`: the same PostgreSQL with no volume
  - `03-seat-api.yaml`: three seat-api replicas behind a Service
- `seat-api/` — a small Node.js server with `POST /reserve`, plus `race.js`,
  which sends many bookings at once from inside the cluster.
- `setup.sql` — the seat table from Last Seat Lab.
- `notes/` — results from each session.

## Results

- **Disk vs no disk:** with a volume, A1 survived pod kills and a full cluster
  shutdown. Without one, the whole table disappeared while the pod still
  reported `1/1 Running`.
- **Safe booking, 200 people, 3 servers:** exactly 1 winner.
- **Check-then-act with a 50 ms gap:** 17 people told they won, 1 actual owner.
- **All servers killed mid-request:** 200 errors; the real owner saw an error.
- **Idempotent booking plus retries:** 0 errors; the owner was told they won on
  the second attempt.

## Run it

Prerequisites: Docker (for example via [colima](https://github.com/abiosoft/colima)),
[kind](https://kind.sigs.k8s.io/) and `kubectl`.

```bash
kind create cluster --name last-seat
kubectl apply -f k8s/02-postgres.yaml
kubectl exec -i postgres-0 -- psql -U postgres -d last_seat_lab < setup.sql

docker build -t seat-api:dev seat-api
kind load docker-image seat-api:dev --name last-seat
kubectl apply -f k8s/03-seat-api.yaml
```

Race 200 bookings (`safe` or `naive`, add `retry` to retry after errors):

```bash
kubectl run race --rm -i --restart=Never --image=seat-api:dev \
  --image-pull-policy=Never -- node race.js safe 200
```

Server settings for experiments, set with `kubectl set env deploy/seat-api`:

- `CHECK_DELAY_MS`: pause between the check and the write in `naive` mode
- `REPLY_DELAY_MS`: pause after booking, before replying (for crash tests)

The Postgres password in `k8s/02-postgres.yaml` is a throwaway value for a
local cluster. Never commit real secrets.
