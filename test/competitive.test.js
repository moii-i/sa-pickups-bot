import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { handleInteraction } from '../src/interactions.js';
import { balancedTeams } from '../src/matchmaking.js';
import { POSITIONS, POSITION_NAMES } from '../src/rules.js';
import { PickupStore } from '../src/store.js';

const guild = '200000000000000001';
const firstChannel = '500000000000000001';
const secondChannel = '500000000000000002';
const app = '100000000000000001';
const config = { guildId: guild, appId: app, channels: [firstChannel, secondChannel] };
const staff = '400000000000000099';
const players = Object.entries(POSITIONS).flatMap(([position, slots]) => Array(slots).fill(position))
  .map((position, i) => ({ user_id: String(400_000n * 10n ** 12n + BigInt(i)), position, rating: (i + 1) * 10 }));

test('El balance encuentra la menor diferencia posible conservando las posiciones por equipo', () => {
  const blue = balancedTeams(players);
  const picked = players.filter((p) => blue.has(p.user_id));
  assert.equal(picked.length, 5);
  assert.deepEqual(Object.keys(POSITIONS).map((pos) => picked.filter((p) => p.position === pos).length), [2, 1, 1, 1]);
  const blueRating = picked.reduce((sum, p) => sum + p.rating, 0);
  assert.equal(Math.abs(2 * blueRating - 550), 10);
  assert.throws(() => balancedTeams(players.slice(0, -1)), /cupos de CF/);
});

test('Flujo 5v5 con cupos, cinco votos distintos, marcador y cierre', (t) => {
  const store = new PickupStore(':memory:');
  t.after(() => store.db.close());
  let count = 0;
  const send = (user, type, data, channel = firstChannel) => handleInteraction({
    id: String(++count), type, data, guild_id: guild, application_id: app, channel: { id: channel },
    member: { user: { id: user, username: user }, permissions: user === staff ? '32' : '0', roles: [] },
  }, store, config);
  const slash = (name, args = {}, channel = firstChannel) => send(staff, 2, {
    name: 'pickup', options: [{ name, options: Object.entries(args).map(([name, value]) => ({ name, value })) }],
  }, channel);
  const click = (user, action, values, channel = firstChannel, id = 1) =>
    send(user, 3, { custom_id: `sap:${action}:${id}`, values }, channel);
  const positionMenu = (reply) => reply.data.components.flatMap((row) => row.components).find((component) => component.type === 3);

  store.create({ guild, channel: firstChannel }, 5, 'legacy-position-1');
  const open = slash('ver', { id: 1 });
  assert.equal(positionMenu(open).custom_id, 'sap:position:1');
  assert.deepEqual(positionMenu(open).options.map(({ value, description }) => [value, description]), [
    ['Winger', '4 cupos libres'], ['GK', '2 cupos libres'], ['CM', '2 cupos libres'], ['CF', '2 cupos libres'],
  ]);
  assert.deepEqual(open.data.embeds[0].fields.map((field) => field.name), [
    '⚡ Extremo (Winger) · 0/4', '🧤 Portero (GK) · 0/2', '🛡️ Mediocampista (CM) · 0/2', '🎯 Delantero (CF) · 0/2',
  ]);
  const first = players[0].user_id;
  const joined = click(first, 'position', ['GK']);
  assert.equal(joined.type, 7);
  assert.equal(joined.data.embeds[0].fields[1].value, `🟢 <@${first}>\n↳ 1 cupo libre`);
  assert.equal(positionMenu(joined).options.find(({ value }) => value === 'GK').description, '1 cupo libre');
  const switched = click(first, 'position', ['Winger']);
  assert.equal(switched.data.embeds[0].fields[1].value, '↳ 2 cupos libres');
  assert.match(switched.data.embeds[0].fields[0].value, new RegExp(first));
  assert.equal(click(first, 'leave').data.embeds[0].fields[0].value, '↳ 4 cupos libres');
  assert.throws(() => store.create({ guild, channel: secondChannel }, 2, 'legacy-invalid', 'positional'), /5v5/);
  store.create({ guild, channel: secondChannel }, 1, 'legacy-manual-2');
  for (const { user_id, position } of players) {
    assert.equal(click(user_id, 'position', [position]).type, 7);
  }
  const full = slash('ver', { id: 1 });
  assert.match(full.data.embeds[0].description, /10\/10 inscritos.*Cupos completos/s);
  assert.equal(positionMenu(full), undefined);
  assert.deepEqual(positionMenu(click(first, 'leave')).options.map(({ value }) => value), ['Winger']);
  assert.equal(click(first, 'position', ['Winger']).type, 7);
  assert.match(click(first, 'position', ['GK']).data.content, /cupos de GK/);
  assert.equal(store.roster(1).find((p) => p.user_id === first).position, 'Winger');
  assert.match(click(staff, 'position', ['GK']).data.content, /cupos de GK/);
  assert.match(click(players[0].user_id, 'A', [], secondChannel, 2).data.content, /inscrito/);
  const lineup = slash('iniciar', { id: 1 }).data.embeds[0].fields;
  assert.deepEqual(lineup.map((field) => field.name), ['🔵 Equipo Azul · 5/5', '🔴 Equipo Rojo · 5/5']);
  for (const [index, team] of ['A', 'B'].entries()) {
    const roster = store.roster(1).filter((p) => p.team === team);
    assert.deepEqual(Object.keys(POSITIONS).map((pos) => roster.filter((p) => p.position === pos).length), [2, 1, 1, 1]);
    assert.notEqual(lineup[index].inline, true);
    const markers = { Winger: '⚡', GK: '🧤', CM: '🛡️', CF: '🎯' };
    assert.deepEqual(lineup[index].value.split('\n'), roster.map((p, i) => `${i + 1}. ${markers[p.position]} **${POSITION_NAMES[p.position]}** · <@${p.user_id}>`));
  }

  assert.match(click(staff, 'finished').data.content, /solo votan/i);
  for (const { user_id } of players.slice(0, 4)) {
    click(user_id, 'finished');
    click(user_id, 'finished');
  }
  const before = slash('ver', { id: 1 });
  assert.match(before.data.components[0].components[0].label, /4\/5/);
  const opened = send(players[4].user_id, 2, { name: 'pickup', options: [{ name: 'confirmar', options: [{ name: 'id', value: 1 }] }] });
  assert.match(opened.data.embeds[0].description, /Marcador pendiente/);
  const deadline = store.pickup({ guild, channel: firstChannel }, 1).vote_until;
  assert.equal(click(players[0].user_id, 'A', [], secondChannel, 2).type, 7);
  assert.match(slash('cerrar', { id: 1 }).data.content, /registra el marcador/i);
  assert.match(slash('terminar', { id: 1, marcador: '3-1', resultado: 'B' }).data.content, /contradice/);
  assert.match(slash('terminar', { id: 1, marcador: '3-1' }).data.embeds[0].description, /Azul 3–1 Rojo/);
  assert.equal(store.pickup({ guild, channel: firstChannel }, 1).vote_until, deadline);
  assert.equal(store.pickup({ guild, channel: firstChannel }, 1).result_by, staff);
  assert.match(slash('finalizar', { id: 1, marcador: '2-3' }).data.embeds[0].description, /Azul 2–3 Rojo/);
  assert.equal(click(players[0].user_id, 'mvp').data.components[0].components[0].options.length, 9);
  assert.equal(click(players[0].user_id, 'vote', [players[1].user_id]).data.flags, 64);
  assert.equal(slash('calificar', { id: 1 }).data.components[0].label, 'Equipo Azul · 5 notas');
  const form = send(staff, 5, { custom_id: 'sap:grades:1', components: [
    { component: { custom_id: 'A', value: '8\n8\n8\n8\n8' } },
    { component: { custom_id: 'B', value: '7\n7\n7\n7\n7' } },
  ] });
  assert.match(form.data.content, /10 notas/);
  const refreshed = click(players[0].user_id, 'refresh');
  assert.equal(refreshed.type, 7);
  assert.match(refreshed.data.embeds[0].description, /Votos MVP:\*\* 1\/10/);
  assert.match(refreshed.data.embeds[0].description, /Notas capturadas:\*\* 10\/10/);
  store.now = () => deadline;
  const result = slash('cerrar', { id: 1 }).data.embeds[0];
  assert.match(result.title, /Rojo gana/);
  assert.match(result.fields.find((field) => field.name.includes('MVP')).value, new RegExp(players[1].user_id));
});

test('La racha de la tarjeta se conserva tras una derrota y las amistosas no cuentan', (t) => {
  let now = 0;
  const store = new PickupStore(':memory:', () => now);
  t.after(() => store.db.close());
  const a = { guild, channel: firstChannel, user: players[0].user_id, name: 'Azul' };
  const b = { ...a, user: '400000000000000008', name: 'Rojo' };
  for (const [index, outcome] of ['A', 'A', 'amistosa', 'A', 'B', 'A', 'A'].entries()) {
    const friendly = outcome === 'amistosa';
    const open = store.create(a, 1, `racha-${index}`, 'manual', friendly);
    store.enroll(a, open, 'A');
    store.enroll(b, open, 'B');
    const playing = store.start(open);
    if (friendly) {
      store.close(playing);
      continue;
    }
    const voting = store.finish(playing, staff, { outcome, minutes: 1 });
    store.grade(voting, staff, [{ user: a.user, grade: 80 }, { user: b.user, grade: 80 }]);
    now += 60_001;
    store.close(voting);
  }
  assert.deepEqual(store.profileAchievements(guild, a.user), { wins: 5, mvps: 0, streak: 3 });
  assert.deepEqual(store.profileAchievements(guild, b.user), { wins: 1, mvps: 0, streak: 1 });
});

test('La base de la versión inicial conserva sus notas y su formato al migrar', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sa-pickups-legacy-'));
  const path = join(dir, 'legacy.sqlite');
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE pickups (
      id INTEGER PRIMARY KEY, request_id TEXT UNIQUE, guild_id TEXT, channel_id TEXT,
      team_size INTEGER, status TEXT, outcome TEXT, vote_until INTEGER
    );
    CREATE TABLE players (
      pickup_id INTEGER, user_id TEXT, name TEXT, team TEXT, grade INTEGER, graded_by TEXT,
      PRIMARY KEY (pickup_id, user_id)
    );
    INSERT INTO pickups VALUES (1, 'r1', '${guild}', '${firstChannel}', 5, 'closed', 'A', 0);
    INSERT INTO players VALUES (1, '${staff}', 'Staff', 'A', 87, '${staff}');
  `);
  old.close();

  const migrated = new PickupStore(path);
  t.after(() => {
    migrated.db.close();
    rmSync(dir, { recursive: true });
  });
  assert.equal(migrated.pickup({ guild, channel: firstChannel }, 1).format, 'manual');
  assert.deepEqual({ ...migrated.profile(guild, staff) }, { matches: 1, total: 87, wins: 1 });
  assert.equal(migrated.create({ guild, channel: firstChannel }, 5, 'r2').format, 'positional');
});
