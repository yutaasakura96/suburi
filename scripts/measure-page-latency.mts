import { spawn } from "node:child_process";
import { createConnection, createServer, type Socket } from "node:net";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { cvVersions, rounds, users } from "../db/schema.ts";
import { createAuth } from "../lib/auth/auth.ts";
import { mintSessionCookie } from "../lib/auth/test/session.ts";
import { getConfig } from "../lib/config.ts";
import { devSessionRefusals } from "./dev-session-guard.ts";

// Where a page's time goes between the function and Postgres (#104, 12 §1, 06 2026-10-10). Hand-run,
// never in CI, against a local database holding the develop seed and a production build:
//
//   npm run db:up && npm run db:migrate && npm run db:seed:develop && npm run build
//   node --env-file-if-exists=.env --import ./scripts/resolve-ts.mts scripts/measure-page-latency.mts
//
// It starts `next start` behind a TCP relay that holds every Postgres packet for half of DB_RTT_MS in
// each direction, so the same build is timed as if the database were that far away: 0 is this
// machine, 2 a function in the database's own region, 215 the iad1 function to Neon in
// ap-southeast-1 that develop ran on until #104. The relay also counts what crossed it, which is the
// number a region cannot change: the round trips a page makes, and the connections it had to open.
//
// The session is minted the way `npm run dev:session` mints one, and the same guard refuses anything
// but a local database. Prints paths, counts and milliseconds only — never a row.

const RTTS = (process.env.DB_RTT_MS ?? "0,2,215").split(",").map(Number);
const RUNS = Number(process.env.RUNS ?? 5);
const PORT = Number(process.env.PORT ?? 3104);
const RELAY_PORT = PORT + 1;
// pg's pool closes a connection idle for 10 s (its default), so the next request opens another.
const IDLE_MS = 11_000;

const refusals = devSessionRefusals(process.env);
if (refusals.length > 0) {
  console.error("measure-page-latency refused. It only runs against a local database:");
  for (const reason of refusals) console.error(`  - ${reason}`);
  process.exit(1);
}

const config = getConfig();
const upstream = new URL(config.DATABASE_URL);

type Counters = { connections: number; trips: number };

// One relay per delay. A round trip is a turn of the conversation: the client speaking after the
// server last did. The startup and password exchange are turns too, so a new connection shows up in
// both counters.
function startRelay(delayMs: number, counters: Counters) {
  const sockets = new Set<Socket>();
  const hold = (chunk: Buffer, to: Socket) => {
    if (delayMs === 0) to.write(chunk);
    else setTimeout(() => to.writable && to.write(chunk), delayMs);
  };
  const server = createServer((client) => {
    counters.connections += 1;
    const database = createConnection(Number(upstream.port), upstream.hostname);
    let clientSpoke = false;
    for (const socket of [client, database]) {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => sockets.delete(socket));
    }
    client.on("data", (chunk: Buffer) => {
      if (!clientSpoke) counters.trips += 1;
      clientSpoke = true;
      hold(chunk, database);
    });
    database.on("data", (chunk: Buffer) => {
      clientSpoke = false;
      hold(chunk, client);
    });
    client.on("close", () => setTimeout(() => database.destroy(), delayMs));
    database.on("close", () => setTimeout(() => client.destroy(), delayMs));
  });
  return new Promise<{ close(): Promise<void> }>((resolve) => {
    server.listen(RELAY_PORT, "127.0.0.1", () =>
      resolve({
        close: () =>
          new Promise<void>((closed) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => closed());
          }),
      }),
    );
  });
}

async function startApp() {
  const relayed = new URL(upstream);
  relayed.hostname = "127.0.0.1";
  relayed.port = String(RELAY_PORT);
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
    env: { ...process.env, DATABASE_URL: relayed.href },
    stdio: "ignore",
  });
  const exited = new Promise<void>((resolve) => app.once("exit", () => resolve()));
  for (let attempt = 0; attempt < 100; attempt++) {
    const up = await fetch(`http://localhost:${PORT}/sign-in`).then((r) => r.ok, () => false);
    if (up) return { stop: () => (app.kill(), exited) };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  app.kill();
  throw new Error("next start did not come up. Run `npm run build` first.");
}

// The signed-in user, a session for them, and one row of each kind a detail page needs.
async function prepare() {
  const db = drizzle(config.DATABASE_URL_UNPOOLED);
  try {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, config.ALLOWED_EMAIL));
    if (!user) throw new Error("No user row. Run `npm run db:seed:develop` first.");
    const [round] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(eq(rounds.userId, user.id))
      .orderBy(desc(rounds.startedAt))
      .limit(1);
    const [version] = await db
      .select({ id: cvVersions.id })
      .from(cvVersions)
      .where(eq(cvVersions.userId, user.id))
      .limit(1);
    if (!round || !version) throw new Error("No round or CV. Run `npm run db:seed:develop` first.");
    const cookie = await mintSessionCookie(createAuth({ db, transaction: true }), user.id);
    return { cookie: `${cookie.name}=${cookie.value}`, roundId: round.id, versionId: version.id };
  } finally {
    await db.$client.end();
  }
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const { cookie, roundId, versionId } = await prepare();
const paths = [
  "/",
  "/round/new",
  "/history",
  `/history/${roundId}`,
  `/round/${roundId}/feedback`,
  "/progress",
  "/cv",
  `/cv/versions/${versionId}`,
  "/status",
  `/api/rounds/${roundId}`,
];
const label = (path: string) => path.replace(roundId, "{roundId}").replace(versionId, "{id}");

type Row = { trips: number; connections: number; ms: Map<number, number> };
const rows = new Map<string, Row>();
const row = (name: string) => {
  if (!rows.has(name)) rows.set(name, { trips: 0, connections: 0, ms: new Map() });
  return rows.get(name)!;
};

for (const rtt of RTTS) {
  const counters: Counters = { connections: 0, trips: 0 };
  const relay = await startRelay(rtt / 2, counters);
  const app = await startApp();
  const timed = async (path: string) => {
    const before = { ...counters };
    const started = performance.now();
    // Redirects are followed, as the browser follows them: /history is two requests.
    const response = await fetch(`http://localhost:${PORT}${path}`, { headers: { cookie } });
    await response.arrayBuffer();
    if (response.status !== 200) throw new Error(`${label(path)} answered ${response.status}`);
    return {
      ms: performance.now() - started,
      trips: counters.trips - before.trips,
      connections: counters.connections - before.connections,
    };
  };
  try {
    // The first request also opens the pool's first connection; it is timed below, after an idle.
    await timed("/");
    for (const path of paths) {
      await timed(path);
      const runs = [];
      for (let run = 0; run < RUNS; run++) runs.push(await timed(path));
      const measured = row(label(path));
      measured.trips = median(runs.map((r) => r.trips));
      measured.connections = median(runs.map((r) => r.connections));
      measured.ms.set(rtt, median(runs.map((r) => r.ms)));
    }
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
    const idle = await timed("/");
    const measured = row(`/ after ${IDLE_MS / 1000} s idle`);
    measured.trips = idle.trips;
    measured.connections = idle.connections;
    measured.ms.set(rtt, idle.ms);
  } finally {
    await app.stop();
    await relay.close();
  }
}

console.log(`Median of ${RUNS} warm requests each. Server time only: no browser, no network to the function.`);
console.log(["path", "db round trips", "new connections", ...RTTS.map((rtt) => `${rtt} ms RTT`)].join(" | "));
for (const [name, measured] of rows) {
  const times = RTTS.map((rtt) => `${Math.round(measured.ms.get(rtt) ?? NaN)} ms`);
  console.log([name, measured.trips, measured.connections, ...times].join(" | "));
}
