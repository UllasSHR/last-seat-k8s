// race.js: 200 people click "Book A1" at the same moment.
// Runs INSIDE the cluster and talks to the "seat-api" Service, so Kubernetes
// spreads the requests across all 3 seat-api pods.
//
// Usage: node race.js <safe|naive> [people]
const mode = process.argv[2] ?? "safe";
const people = Number(process.argv[3] ?? 200);
const API = process.env.API ?? "http://seat-api";

await fetch(`${API}/reset`, { method: "POST" });
console.log(`Seat A1 reset. ${people} people booking at once, mode=${mode}\n`);

// Fire every request at the same time, then wait for all of them.
const results = await Promise.all(
  Array.from({ length: people }, async (_, i) => {
    const name = `user-${i}`;
    try {
      const res = await fetch(`${API}/reserve?name=${name}&mode=${mode}`, {
        method: "POST",
      });
      return { name, ...(await res.json()) };
    } catch (err) {
      return { name, error: err.cause?.code ?? err.message };
    }
  }),
);

const winners = results.filter((r) => r.won === true);
const errors = results.filter((r) => r.error);
const perPod = {};
for (const r of results) if (r.pod) perPod[r.pod] = (perPod[r.pod] ?? 0) + 1;

// If pods were just killed, the Service may briefly have no ready pods.
// Retry reading the seat until a server answers.
let seat;
for (let attempt = 0; !seat; attempt++) {
  try {
    seat = await (await fetch(`${API}/seat`)).json();
  } catch (err) {
    if (attempt > 30) throw err;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

console.log("Requests handled per pod:");
for (const [pod, n] of Object.entries(perPod)) console.log(`  ${pod}: ${n}`);
console.log(`\nPeople told "you got the seat!": ${winners.length}`);
for (const w of winners.slice(0, 10)) console.log(`  ${w.name} (via ${w.pod})`);
if (winners.length > 10) console.log(`  ...and ${winners.length - 10} more`);
console.log(`Errors: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log(`  ${e.name}: ${e.error}`);
const owner = seat.seat.reserved_by;
console.log(`\nWhat Postgres actually says: A1 -> ${owner}`);

// The real owner: what did THEY see on their screen?
const ownerResult = results.find((r) => r.name === owner);
if (ownerResult) {
  const saw = ownerResult.error
    ? `an ERROR (${ownerResult.error})`
    : ownerResult.won
      ? `"you got the seat!"`
      : `"sorry, seat taken"`;
  console.log(`What ${owner} saw on their screen: ${saw}`);
}
