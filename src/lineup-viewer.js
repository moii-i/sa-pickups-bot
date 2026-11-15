import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { lineupParties, lineupPlayers } from './lineup-scene.js';
import { PickupError } from './rules.js';

const assets = new Map([
  ['/alineacion/visor.js', ['text/javascript', new URL('../assets/lineup/visor.js', import.meta.url)]],
  ['/alineacion/escena.js', ['text/javascript', new URL('./lineup-scene.js', import.meta.url)]],
  ['/alineacion/arcade.js', ['text/javascript', new URL('./arcade.js', import.meta.url)]],
  ['/alineacion/estilo.css', ['text/css', new URL('../assets/lineup/estilo.css', import.meta.url)]],
  ['/alineacion/fuente.ttf', ['font/ttf', new URL('../assets/lineup/IBMPlexMono-Bold.ttf', import.meta.url)]],
].map(([path,[type,url]]) => [path, [type,readFileSync(url)]]));
const page = readFileSync(new URL('../assets/lineup/visor.html', import.meta.url));
const secureHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
const pendingTime = 5 * 60_000;
const sessionTime = 4 * 60 * 60_000;

export function renderLineupGif(players, parties = []) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./lineup-render.js', import.meta.url), { workerData: { players, parties }, execArgv: [] });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`El renderizador de alineación terminó con código ${code}.`)));
  });
}

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { ...secureHeaders, 'Content-Type': type, ...headers });
  res.end(body);
}

export function createLineupViewer(store, guilds, baseUrl) {
  const guildIds = Array.isArray(guilds) ? guilds : [guilds];
  const sessions = new Map();
  const pathFor = (id) => `/alineacion/${id}`;
  const urlFor = (id) => new URL(pathFor(id), baseUrl).href;

  function getSession(req, id) {
    const cookie = /(?:^|;\s*)sap-lineup=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
    const session = sessions.get(cookie);
    return session?.id === id && session.until > Date.now() ? session : undefined;
  }

  function serve(req, res) {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/alineacion/')) return false;
    if (req.method !== 'GET') {
      send(res, 405, 'text/plain; charset=utf-8', 'Método no permitido', { Allow: 'GET' });
      return true;
    }
    const asset = assets.get(path);
    if (asset) {
      send(res, 200, asset[0], asset[1]);
      return true;
    }
    const match = /^\/alineacion\/([1-9][0-9]{0,14})(\/datos)?$/.exec(path);
    const id = Number(match?.[1]);
    const session = getSession(req, id);
    const pickup = match && guildIds.some((guildId) => store.activeLineup(guildId, id));
    if (!pickup) {
      if (match?.[2] && session?.user && guildIds.some((guildId) => store.lineupWaiting(guildId, id)) &&
          store.roster(id).some((p) => p.user_id === session.user)) {
        send(res, 409, 'text/plain; charset=utf-8', 'Buscando reemplazo.');
        return true;
      }
      send(res, 404, 'text/plain; charset=utf-8', 'Esta alineación ya no está disponible.');
      return true;
    }
    if (match[2]) {
      const roster = session?.user ? store.roster(id) : [];
      const data = roster.some((p) => p.user_id === session.user)
        ? { id, players: lineupPlayers(roster), parties: lineupParties(roster) } : { code: session?.code ?? null };
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify(data));
      return true;
    }
    if (session) {
      send(res, 200, 'text/html; charset=utf-8', page);
      return true;
    }
    for (const [token, pending] of sessions) {
      if (pending.until <= Date.now()) sessions.delete(token);
    }
    if (sessions.size >= 500) {
      send(res, 503, 'text/plain; charset=utf-8', 'El visor está ocupado. Intenta en unos minutos.');
      return true;
    }
    const token = randomBytes(24).toString('hex');
    let code;
    do { code = randomBytes(4).toString('hex').toUpperCase(); }
    while ([...sessions.values()].some((pending) => pending.id === id && pending.code === code));
    sessions.set(token, { id, code, until: Date.now() + pendingTime });
    send(res, 200, 'text/html; charset=utf-8', page, {
      'Set-Cookie': `sap-lineup=${token}; Path=${pathFor(id)}; Max-Age=${sessionTime/1000}; Secure; HttpOnly; SameSite=Lax`,
    });
    return true;
  }

  function authorize(pickup, channel, user, code, guildId = guildIds[0]) {
    const active = guildIds.includes(guildId) && store.activeLineup(guildId, pickup);
    if (!active || active.room_channel_id !== channel || !store.roster(pickup).some((p) => p.user_id === user)) {
      throw new PickupError('Solo los jugadores de esta pickup pueden autorizar el visor desde su sala.');
    }
    if (!code) return;
    const session = [...sessions.values()].find((p) =>
      p.id === pickup && p.until > Date.now() && p.code === code.trim().toUpperCase());
    if (!session) throw new PickupError('El código ya venció o no corresponde a esta pickup. Recarga el visor y usa el nuevo.');
    delete session.code;
    session.user = user;
    session.until = Date.now() + sessionTime;
  }

  return { serve, urlFor, authorize };
}
