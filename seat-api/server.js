// seat-api: one tiny HTTP server that books seat A1 in Postgres.
// Kubernetes will run 3 copies of this. Each copy replies with its own pod
// name so we can see which server handled each request.
import http from "node:http";
import os from "node:os";
import pg from "pg";

const POD = os.hostname(); // inside Kubernetes, this is the pod name

// A pool of connections to Postgres. "postgres" is the Service name from
// k8s/02-postgres.yaml; Kubernetes DNS turns it into postgres-0's address.
const db = new pg.Pool({
  host: process.env.PGHOST ?? "postgres",
  user: "postgres",
  password: process.env.PGPASSWORD,
  database: "last_seat_lab",
  max: 10,
});

// ---------------------------------------------------------------------------
// YOUR TURN: the correct booking.
//
// Book seat A1 for `name`, but ONLY if nobody has it yet, in ONE statement,
// so Postgres itself decides the winner (this is your Last Seat Lab query).
//
// Return true if this request won the seat, false otherwise.
// Hints:
//   - const result = await db.query("<your SQL with $1>", [name]);
//   - result.rowCount tells you how many rows the UPDATE changed.
// ---------------------------------------------------------------------------
async function reserveSafe(name) {
  const result = await db.query("UPDATE seats SET reserved_by = $1 WHERE seat_code = 'A1' AND (reserved_by IS NULL OR reserved_by = $1)", [name]);
  return result.rowCount > 0;
}

// ---------------------------------------------------------------------------
// The BUGGY way, written on purpose. This is "check, then act":
//   1. ask "is the seat free?"
//   2. if yes, write my name
// Between step 1 and step 2, other servers can ALSO see "free" and ALSO write.
// Every one of them will tell its user "you got the seat!".
// ---------------------------------------------------------------------------
async function reserveNaive(name) {
  const check = await db.query(
    "SELECT reserved_by FROM seats WHERE seat_code = 'A1'",
  );
  if (check.rows[0].reserved_by !== null) return false;

  // Real apps do work here (payment check, logging...). CHECK_DELAY_MS lets us
  // widen this gap to make the race easier to see. Default: no delay.
  const delay = Number(process.env.CHECK_DELAY_MS ?? 0);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));

  await db.query("UPDATE seats SET reserved_by = $1 WHERE seat_code = 'A1'", [
    name,
  ]);
  return true;
}

// ---------------------------------------------------------------------------
// HTTP routes
//   POST /reserve?name=alice&mode=safe|naive  -> try to book A1
//   GET  /seat                                -> who has A1 right now
//   POST /reset                               -> make A1 free again
//   GET  /healthz                             -> "am I alive?" for Kubernetes
// ---------------------------------------------------------------------------
function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ pod: POD, ...body }) + "\n");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "POST" && url.pathname === "/reserve") {
      const name = url.searchParams.get("name");
      if (!name) return reply(res, 400, { error: "name is required" });
      const mode = url.searchParams.get("mode") ?? "safe";
      const won =
        mode === "naive" ? await reserveNaive(name) : await reserveSafe(name);

      // The booking is now COMMITTED in Postgres. Real servers often do more
      // work before replying (send a confirmation email, write logs...).
      // REPLY_DELAY_MS widens that window so we can kill a pod inside it.
      const replyDelay = Number(process.env.REPLY_DELAY_MS ?? 0);
      if (replyDelay > 0) await new Promise((r) => setTimeout(r, replyDelay));

      return reply(res, 200, { name, mode, won });
    }
    if (req.method === "GET" && url.pathname === "/seat") {
      const r = await db.query("SELECT * FROM seats WHERE seat_code = 'A1'");
      return reply(res, 200, { seat: r.rows[0] });
    }
    if (req.method === "POST" && url.pathname === "/reset") {
      await db.query("UPDATE seats SET reserved_by = NULL WHERE seat_code = 'A1'");
      return reply(res, 200, { reset: true });
    }
    if (url.pathname === "/healthz") return reply(res, 200, { ok: true });
    return reply(res, 404, { error: "not found" });
  } catch (err) {
    return reply(res, 500, { error: err.message });
  }
});

server.listen(3000, () => console.log(`seat-api on ${POD} listening on :3000`));
