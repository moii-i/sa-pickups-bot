import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applicationCommands, pickupCommand } from '../src/commands.js';
import { handleInteraction } from '../src/interactions.js';
import { arcadeUrls } from '../src/media.js';
import { gradeInTenths, rankFor } from '../src/rules.js';
import { interactionHandler } from '../src/server.js';
import { PickupStore } from '../src/store.js';

const host = '400000000000000001';
const a = '400000000000000002';
const b = '400000000000000003';
const other = '400000000000000004';
const config = {
  appId: '100000000000000001',
  guildId: '200000000000000001',
  staffRole: '300000000000000001',
  playerRole: '300000000000000002',
  channels: ['500000000000000001', '500000000000000002'],
};
let interactionId = 0;
function interaction(type, user, data, overrides) {
  return {
    type,
    id: String(++interactionId),
    application_id: config.appId,
    guild_id: config.guildId,
    channel: { id: config.channels[0] },
    member: {
      user: { id: user, username: 'Jugador ' + user.at(-1) },
      roles: [user === host ? config.staffRole : config.playerRole],
      permissions: '0',
    },
    data,
    ...overrides,
  };
}
function command(user, name, args = {}, overrides = {}) {
  return interaction(2, user, {
    name: 'pickup',
    options: [{ name, options: Object.entries(args).map(([name, value]) => ({ name, value })) }],
  }, overrides);
}

test('Escala exacta, nota con coma y mínimo de tres pickups', () => {
  assert.equal(gradeInTenths('8,5'), 85);
  assert.throws(() => gradeInTenths('8.55'));
  assert.throws(() => gradeInTenths('10.1'));
  assert.equal(rankFor(200, 2), 0);
  for (const [sum, stars] of [[0, 1], [149, 1], [150, 2], [180, 3], [210, 4], [240, 5], [269, 5], [270, 6], [300, 6]]) {
    assert.equal(rankFor(sum, 3), stars);
  }
  assert.equal(new Set(pickupCommand.options.map((o) => o.name)).size, pickupCommand.options.length);
  assert.deepEqual(pickupCommand.options.find((o) => o.name === 'crear').options[0].choices.map((choice) => choice.value), ['competitiva', 'amistosa']);
  assert.deepEqual(applicationCommands.map((o) => o.name), ['pickup', 'perfil', 'clasificacion', 'grupo', 'help']);
  assert.ok(pickupCommand.options.every((o) => !['perfil', 'ranking', 'finalizar'].includes(o.name)));
});

test('Pickup completa por HTTP firmado, permisos, MVP y notas persistentes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sa-pickups-test-'));
  const file = join(dir, 'test.sqlite');
  let now = 1_800_000_000_000;
  const store = new PickupStore(file, () => now);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const media = arcadeUrls('https://example.com');
  const handler = interactionHandler(store, { ...config, publicKey: publicKeyHex, media });
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true });
  });

  async function request(method, url, headers = {}, body) {
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(body)]), { method, url, headers });
    let status;
    let response;
    await handler(req, {
      setHeader() {},
      writeHead(code) { status = code; },
      end(output) { response = JSON.parse(output); },
    });
    return { status, response };
  }

  async function post(payload, { valid = true, stale = false } = {}) {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000) - (stale ? 600 : 0));
    const signature = valid ? sign(null, Buffer.from(timestamp + body), privateKey).toString('hex') : '0'.repeat(128);
    return request('POST', '/discord/interactions', {
      'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp,
    }, body);
  }
  const send = async (payload) => {
    const { status, response } = await post(payload);
    assert.equal(status, 200);
    return response;
  };
  const slash = (user, name, args, overrides) => send(command(user, name, args, overrides));
  const click = (user, action, id, values) => send(interaction(3, user, { custom_id: `sap:${action}:${id}`, values }));
  assert.equal((await request('GET', '/health')).status, 200);
  const helpRequest = interaction(2, other, { name: 'help' }, {
    channel: { id: '500000000000000003' }, member: { user: { id: other }, roles: [] },
  });
  const help = await send(helpRequest);
  assert.equal(help.data.flags, 64);
  assert.equal(help.data.embeds[0].image.url, 'https://example.com/assets/arcade/ayuda.gif');
  assert.match(help.data.embeds[0].fields.map((field) => field.value).join('\n'), /\/pickup crear/);
  assert.match((await send({ ...helpRequest, guild_id: '200000000000000002' })).data.content, /exclusivo/);
  assert.equal((await post({ type: 1 }, { valid: false })).status, 401);
  assert.equal((await post({ type: 1 }, { stale: true })).status, 401);
  assert.deepEqual(await send({ type: 1 }), { type: 1 });

  assert.match((await slash(a, 'crear')).data.content, /organización/);
  assert.match((await slash(a, 'perfil', {}, { guild_id: 'otro' })).data.content, /exclusivo/);
  assert.match((await slash(a, 'perfil', {}, { channel: { id: 'otro' } })).data.content, /canal autorizado/);
  assert.match((await slash(a, 'perfil', {}, { member: { user: { id: a }, roles: [], permissions: '0' } })).data.content, /rol de jugador/);
  const emptyProfile = (await slash(a, 'perfil')).data;
  assert.equal(emptyProfile.flags, 64);
  assert.equal(emptyProfile.embeds[0].fields[0].value, '**En clasificación · 0/3**\n`▱▱▱`');
  assert.equal(emptyProfile.embeds[0].fields[1].value, '—');
  assert.match(emptyProfile.embeds[0].fields.at(-1).value, /primera partida/);
  assert.match((await click(a, 'arcade', 'title', ['mvp'])).data.content, /todavía no está desbloqueado/);

  const create = command(host, 'crear');
  store.create({ guild: config.guildId, channel: config.channels[0] }, 1, create.id);
  const open = (await send(create)).data.embeds[0];
  assert.match(open.title, /#1/);
  assert.equal(open.image.url, media.convocatoria);
  assert.match((await send(create)).data.embeds[0].title, /#1/);
  assert.match((await slash(host, 'crear')).data.content, /ya hay/i);
  assert.match((await slash(host, 'ver', { id: 1 }, { channel: { id: config.channels[1] } })).data.content, /no encontré/i);

  assert.equal((await click(a, 'A', 1)).type, 7);
  assert.match((await click(b, 'A', 1)).data.content, /lleno/);
  assert.match((await slash(host, 'iniciar', { id: 1 })).data.content, /llena/i);
  assert.equal((await click(b, 'B', 1)).type, 7);
  const playing = (await slash(host, 'iniciar', { id: 1 })).data.embeds[0];
  assert.match(playing.title, /En juego/);
  assert.equal(playing.image.url, media['en-juego']);
  assert.match((await click(b, 'leave', 1)).data.content, /cerraron/);
  const voting = (await slash(host, 'terminar', { id: 1, resultado: 'A', minutos: 1 })).data.embeds[0];
  assert.match(voting.description, /Victoria del equipo Azul/);
  assert.equal(voting.image.url, media.mvp);

  assert.equal((await click(a, 'mvp', 1)).data.components[0].components[0].options[0].value, b);
  const ballot = (await slash(a, 'votar', { id: 1 })).data;
  assert.equal(ballot.flags, 64);
  assert.match(ballot.embeds[0].title, /jugador más valioso/);
  assert.equal(ballot.embeds[0].image.url, media.mvp);
  assert.match((await click(other, 'vote', 1, [b])).data.content, /solo votan/i);
  assert.match((await click(a, 'vote', 1, [a])).data.content, /otro jugador/);
  assert.equal((await click(a, 'vote', 1, [b])).data.flags, 64);
  await click(a, 'vote', 1, [b]);
  assert.equal(store.voteCount(1), 1);
  assert.match((await slash(host, 'cerrar', { id: 1 })).data.content, /faltan 2 notas/i);

  const modal = await slash(host, 'calificar', { id: 1 });
  assert.equal(modal.type, 9);
  const grade = (user, A, B) => send(interaction(5, user, {
    custom_id: modal.data.custom_id,
    components: [
      { type: 18, component: { custom_id: 'A', value: A } },
      { type: 18, component: { custom_id: 'B', value: B } },
    ],
  }));
  assert.match((await grade(a, '9', '8')).data.content, /solo la organización/i);
  assert.match((await grade(host, '9', '11')).data.content, /del 0 al 10/);
  assert.equal(store.roster(1)[0].grade, null);
  assert.match((await grade(host, '9', '8.5')).data.content, /2 notas/);
  assert.match((await slash(host, 'cerrar', { id: 1 })).data.content, /votación sigue abierta/);
  await click(b, 'vote', 1, [a]);
  assert.match((await slash(host, 'cerrar', { id: 1 })).data.embeds[0].description, /MVP compartido/);
  const closed = (await slash(host, 'cerrar', { id: 1 })).data.embeds[0];
  assert.match(closed.title, /Azul gana/);
  assert.equal(closed.image.url, media.victoria);
  assert.equal(closed.thumbnail.url, media.mvp);
  const profileRequest = interaction(2, a, { name: 'perfil' }, { channel: { id: 'social' } });
  profileRequest.member.user.avatar = 'a_7f87f050de236c7d2f04fbd43a020518';
  const profile = (await send(profileRequest)).data;
  assert.equal(profile.flags, undefined);
  assert.equal(profile.embeds[0].thumbnail.url, media.perfil);
  assert.match(profile.embeds[0].image.url, /^https:\/\/cdn\.discordapp\.com\/avatars\/.*\.gif\?size=256$/);
  assert.deepEqual(profile.embeds[0].fields.map(({ value }) => value), [
    '**En clasificación · 1/3**\n`▰▱▱`', '**9.00/10**', '**1** · 100%', '**1**', '**1**', '**1** victoria seguida',
    '🌟 **Jugador estelar**\n🔒 Consigue 5 victorias\n🔒 Gana 3 competitivas seguidas', '🏆 Victoria · #1 · **9.0/10**',
  ]);
  assert.equal((await click(a, 'arcade', 'edit')).data.flags, 64);
  assert.equal((await click(a, 'arcade', 'position', ['CM'])).type, 7);
  await click(a, 'arcade', 'title', ['mvp']);
  const styled = (await click(a, 'arcade', 'frame', ['mvp'])).data.embeds[0];
  assert.match(styled.description, /Jugador estelar.*Mediocampista/);
  assert.equal(styled.thumbnail.url, media.mvp);
  assert.doesNotMatch((await click(b, 'arcade', 'view')).data.embeds[0].description, /Jugador estelar/);

  for (const id of [2, 3]) {
    store.create({ guild: config.guildId, channel: config.channels[0] }, 1, `legacy-manual-${id}`);
    await click(a, 'A', id);
    await click(b, 'B', id);
    await slash(host, 'iniciar', { id });
    await slash(host, 'finalizar', { id, resultado: 'draw', minutos: 1 });
    await slash(host, 'calificar', { id, jugador: a, nota: '9' });
    await slash(host, 'calificar', { id, jugador: b, nota: '8' });
    now += 60_000;
    assert.match((await click(a, 'vote', id, [b])).data.content, /votación MVP está cerrada/);
    assert.match((await slash(host, 'cerrar', { id })).data.embeds[0].description, /sin votos/);
  }
  assert.equal((await slash(a, 'perfil')).data.embeds[0].fields[0].value, '⭐⭐⭐⭐⭐⭐ · **6/6**');
  const leaderboard = (await send(interaction(2, a, { name: 'clasificacion' }))).data.embeds[0];
  assert.equal(leaderboard.image.url, media.clasificacion);
  assert.match(leaderboard.description, /🥇.*9\.00\/10/);
  assert.match(leaderboard.description, /⭐{6} · 🏆 1 victoria/u);
  await slash(host, 'crear');
  await click(a, 'joinA', 4, ['GK']);
  const canceled = (await slash(host, 'cancelar', { id: 4 })).data.embeds[0];
  assert.match(canceled.title, /Cancelada/);
  assert.equal(canceled.image.url, media['cola-cerrada']);
  const reopened = new PickupStore(file);
  try {
    assert.deepEqual({ ...reopened.profile(config.guildId, a) }, { matches: 3, total: 270, wins: 1 });
    assert.deepEqual({ ...reopened.profileStyle({ guild: config.guildId, user: a }) }, { position: 'CM', frame: 'mvp', title: 'mvp' });
    assert.deepEqual({ ...reopened.profile('otro', a) }, { matches: 0, total: 0, wins: 0 });
  } finally {
    reopened.db.close();
  }
});

test('Una partida 2v2 permite cambiar un voto y conserva el último', () => {
  const store = new PickupStore(':memory:');
  try {
    const send = (payload) => handleInteraction(payload, store, config);
    store.create({ guild: config.guildId, channel: config.channels[0] }, 2, 'legacy-manual-2v2');
    for (const [user, team] of [[host, 'A'], [a, 'A'], [b, 'B'], [other, 'B']]) {
      send(interaction(3, user, { custom_id: `sap:${team}:1` }));
    }
    send(command(host, 'iniciar', { id: 1 }));
    assert.match(send(command(host, 'terminar', { id: 1, resultado: 'draw' })).data.content, /Confirmar fin/);
    send(interaction(3, a, { custom_id: 'sap:finished:1' }));
    send(interaction(3, b, { custom_id: 'sap:finished:1' }));
    send(command(host, 'finalizar', { id: 1, resultado: 'draw' }));
    send(interaction(3, a, { custom_id: 'sap:vote:1', values: [b] }));
    send(interaction(3, a, { custom_id: 'sap:vote:1', values: [other] }));
    assert.deepEqual(store.mvps(1).map((r) => r.user_id), [other]);
    assert.equal(store.voteCount(1), 1);
  } finally {
    store.db.close();
  }
});
