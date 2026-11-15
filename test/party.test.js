import assert from 'node:assert/strict';
import test from 'node:test';
import { handleInteraction } from '../src/interactions.js';
import { arcadeUrls } from '../src/media.js';
import { DRAFT_SLOTS, QUEUE_IDLE_MINUTES, ROOM_RETENTION_HOURS, TEAM_QUEUE_FORMAT } from '../src/rules.js';
import { maintainQueues } from '../src/server.js';
import { PickupStore } from '../src/store.js';

const guild = '200000000000000001';
const channel = '500000000000000001';
const app = '100000000000000001';
const users = Array.from({ length: 12 }, (_, i) => String(400000000000000000n + BigInt(i)));
const media = arcadeUrls('https://example.com');

function harness(t, discord, { hosterRole, roles = {}, roomCategory, cancelRoles, permissions = {} } = {}) {
  let now = 1_800_000_000_000;
  let request = 0;
  const store = new PickupStore(':memory:', () => now);
  t.after(() => store.db.close());
  const user = (id) => ({ id, username: id });
  const send = (data) => handleInteraction({ application_id: app, id: String(++request), ...data }, store, {
    appId: app, guildId: guild, channels: [channel], discord, media, hosterRole, roomCategory, cancelRoles,
  });
  const inGuild = (id) => ({ guild_id: guild, channel_id: channel, member: {
    user: user(id), permissions: permissions[id] ?? (id === users[11] ? '32' : '0'), roles: roles[id] ?? [],
  } });
  const slash = (id, name, action, args = {}, from = channel) => send({
    ...inGuild(id), channel_id: from, type: 2,
    data: { name, options: [{ name: action, options: Object.entries(args).map(([name, value]) => ({ name, value })) }],
      resolved: args.jugador ? { users: { [args.jugador]: user(args.jugador) }, members: { [args.jugador]: { roles: [] } } } : undefined },
  });
  const click = (id, customId, values, from = channel) => send({ ...inGuild(id), channel_id: from, type: 3, data: { custom_id: customId, values } });
  const dm = (id, customId, values) => send({ type: 3, user: user(id), data: { custom_id: customId, values } });
  return { store, slash, click, dm, advance: (ms) => { now += ms; } };
}

function confirmDraft(h, organizer, id, roster) {
  for (const [index, position] of DRAFT_SLOTS.entries()) {
    assert.equal(h.click(organizer, `sap:draftpick:${id}:${position.key}`, [roster[index]]).type, 7);
  }
  assert.match(h.click(organizer, `sap:draftstart:${id}`).data.content, /Pickup iniciada/);
}

test('El hoster confirma la alineación y crea una sola sala privada aunque se interrumpa el alta', async (t) => {
  const category = '500000000000000090';
  const roomId = '500000000000000099';
  const staff = users[11];
  const roster = users.slice(0, 10);
  const notices = [];
  const edits = [];
  const deleted = [];
  let room;
  let creates = 0;
  const discord = {
    guildChannels: async () => room ? [room] : [],
    channel: async () => room,
    createChannel: async (guildId, data) => {
      assert.equal(guildId, guild);
      assert.equal(data.name, 'pickup-1');
      assert.equal(data.parent_id, category);
      assert.equal(data.type, 0);
      assert.deepEqual(data.permission_overwrites[0], { id: guild, type: 0, allow: '0', deny: '1024' });
      const members = data.permission_overwrites.slice(1);
      assert.deepEqual(members.map((entry) => entry.id).sort(), [app, ...roster].sort());
      assert.ok(members.every((entry) => entry.type === 1 && (BigInt(entry.allow) & 1024n) !== 0n));
      creates++;
      room = { ...data, id: roomId, guild_id: guild };
      throw new Error('Respuesta perdida después de crear la sala');
    },
    sendMessage: async (id, data) => { notices.push({ id, data }); return { id: '610000000000000002' }; },
    editMessage: async (...args) => edits.push(args),
    deleteChannel: async (id) => { deleted.push(id); room = undefined; },
  };
  const h = harness(t, discord, { roomCategory: category });
  const config = { appId: app, roomCategory: category };
  const maintain = () => maintainQueues(h.store, discord, media, config);
  h.slash(staff, 'pickup', 'crear');
  h.store.rememberQueuePanel(1, '610000000000000001');
  roster.slice(0, 9).forEach((id) => h.click(id, 'sap:queuejoin:1'));
  await maintain();
  assert.equal(creates, 0);

  h.slash(roster[9], 'grupo', 'crear', { posicion: 'CF' });
  const full = h.slash(roster[9], 'pickup', 'buscar');
  assert.match(full.data.embeds[0].fields[0].name, /10\/25/);
  assert.equal(h.store.room(1), undefined);
  h.click(users[10], 'sap:queuejoin:1');
  confirmDraft(h, staff, 1, roster);
  assert.equal(h.store.pickup({ guild, channel }, 1).status, 'playing');
  assert.match(h.click(roster[0], 'sap:leave:1').data.content, /cola ya no está abierta/);
  assert.equal(h.store.activePickup(guild, users[10]), undefined);
  edits.length = 0;
  await maintain();
  assert.equal(notices.length, 0);
  assert.equal(edits.length, 0);
  await maintain();
  await maintain();
  assert.equal(creates, 1);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].id, roomId);
  assert.deepEqual(notices[0].data.allowed_mentions.users, roster);
  assert.match(notices[0].data.content, /Blue Lock Rivals/);
  assert.deepEqual(edits[0][2].components.flatMap((row) => row.components).map((button) => button.url),
    [`https://discord.com/channels/${guild}/${roomId}`]);
  assert.deepEqual(notices[0].data.components.flatMap((row) => row.components).map((button) => button.custom_id),
    ['sap:finished:1', 'sap:kickmenu:1']);
  assert.match(h.click(roster[0], 'sap:finished:1').data.content, new RegExp(roomId));
  assert.match(h.click(roster[0], 'sap:finished:1', undefined, roomId).data.components[0].components[0].label, /1\/5/);
  h.slash(staff, 'pickup', 'terminar', { id: 1, marcador: '3-1' });
  await maintain();
  assert.deepEqual(edits.findLast(([id]) => id === channel)[2].components.flatMap((row) => row.components).map((button) => button.style), [5]);
  assert.ok(edits.findLast(([id]) => id === roomId)[2].components.flatMap((row) => row.components).some((button) => button.custom_id === 'sap:mvp:1'));

  h.slash(staff, 'pickup', 'cancelar', { id: 1 });
  h.advance(ROOM_RETENTION_HOURS * 3_600_000 - 1);
  await maintain();
  assert.deepEqual(deleted, []);
  h.advance(1);
  await maintain();
  assert.deepEqual(deleted, [roomId]);
  assert.equal(h.store.room(1), undefined);

  h.slash(staff, 'pickup', 'crear');
  h.slash(roster[9], 'grupo', 'salir');
  roster.forEach((id) => h.click(id, 'sap:queuejoin:2'));
  confirmDraft(h, staff, 2, roster);
  assert.equal(h.store.pickup({ guild, channel }, 2).status, 'playing');
});

test('Hoster y los roles superiores abren pickups, incluso al buscar con grupo', async (t) => {
  const baseRole = { id: '300000000000000003', name: 'Hoster', position: 3 };
  const lower = { id: '300000000000000004', name: 'Staff', position: 2 };
  const higher = { id: '300000000000000001', name: 'Coordinación', position: 3 };
  const samePositionBelow = { id: '300000000000000005', name: 'Jugador', position: 3 };
  const [hoster, leader, coordinator] = users;
  const guildRoles = [baseRole, lower, higher, samePositionBelow];
  let unavailable = false;
  const h = harness(t, { roles: async (id) => {
    assert.equal(id, guild);
    if (unavailable) throw new Error('Discord no disponible');
    return guildRoles;
  } }, { hosterRole: baseRole.id, roles: {
    [hoster]: [baseRole.id], [leader]: [samePositionBelow.id], [coordinator]: [higher.id], [users[11]]: [lower.id],
  } });

  for (const player of [leader, users[11]]) {
    const denied = await h.slash(player, 'pickup', 'crear');
    assert.equal(denied.data.flags, 64);
    assert.match(denied.data.content, /Hoster o uno superior/);
  }
  h.slash(leader, 'grupo', 'crear', { posicion: 'GK' });
  assert.match((await h.slash(leader, 'pickup', 'buscar')).data.content, /Hoster o uno superior/);
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS total FROM pickups').get().total, 0);
  unavailable = true;
  assert.match((await h.slash(coordinator, 'pickup', 'crear')).data.content, /consultar los roles/);
  unavailable = false;
  assert.match((await h.slash(hoster, 'pickup', 'crear')).data.embeds[0].title, /#1/);
  unavailable = true;
  assert.match(h.slash(leader, 'pickup', 'buscar').data.embeds[0].fields[0].value, new RegExp(leader));
  assert.match(h.slash(users[11], 'pickup', 'cancelar', { id: 1 }).data.content, /Solo quien abrió/);
  h.slash(hoster, 'pickup', 'cancelar', { id: 1 });
  unavailable = false;
  h.slash(coordinator, 'grupo', 'crear', { posicion: 'CM' });
  assert.match((await h.slash(coordinator, 'pickup', 'buscar')).data.embeds[0].title, /#2/);
});

test('Solo creador y dirección cancelan; la amistosa cierra sin evaluación ni estadísticas', async (t) => {
  const [creator, otherHoster, gradedHoster, director] = users;
  const baseRole = { id: '300000000000000001', name: 'Hoster', position: 10 };
  const gradedRole = { id: '300000000000000002', name: 'Hoster con nota', position: 11 };
  const directorRole = { id: '300000000000000003', name: 'Dirección', position: 15 };
  const legacyRequest = '500000000000000100';
  const roomCategory = '500000000000000090';
  const roomId = '500000000000000099';
  const panelId = '610000000000000001';
  const deleted = [];
  const edits = [];
  let room;
  const discord = {
    roles: async () => [baseRole, gradedRole, directorRole],
    messagesAround: async (origin, id) => {
      assert.equal(origin, channel);
      assert.equal(id, legacyRequest);
      return [{ author: { id: app }, interaction_metadata: { id, type: 2, user: { id: creator } } }];
    },
    guildChannels: async () => room ? [room] : [],
    channel: async () => room,
    createChannel: async (_, data) => (room = { ...data, id: roomId, guild_id: guild }),
    sendMessage: async () => ({ id: '610000000000000002' }),
    deleteChannel: async (id) => { deleted.push(id); room = undefined; },
    editMessage: async (id, message, data) => {
      if (id === roomId && !room) throw Object.assign(new Error('Canal retirado'), { status: 404 });
      edits.push({ id, message, data });
    },
  };
  const h = harness(t, discord, {
    hosterRole: baseRole.id,
    cancelRoles: [directorRole.id],
    roomCategory,
    roles: { [creator]: [baseRole.id], [otherHoster]: [baseRole.id], [gradedHoster]: [gradedRole.id], [director]: [directorRole.id] },
    permissions: { [gradedHoster]: '8' },
  });
  await h.slash(creator, 'pickup', 'crear');
  for (const user of [otherHoster, gradedHoster]) {
    assert.match(h.slash(user, 'pickup', 'cancelar', { id: 1 }).data.content, /Solo quien abrió/);
    assert.match(h.click(user, 'sap:cancel:1').data.content, /Solo quien abrió/);
  }
  assert.match(h.click(creator, 'sap:cancel:1').data.embeds[0].title, /Cancelada/);
  await h.slash(otherHoster, 'pickup', 'crear');
  assert.match(h.slash(director, 'pickup', 'cancelar', { id: 2 }).data.embeds[0].title, /Cancelada/);

  const friendly = await h.slash(creator, 'pickup', 'crear', { modo: 'amistosa' });
  assert.match(friendly.data.embeds[0].title, /Amistosa #3/);
  assert.equal(friendly.data.embeds[0].image.url, media.amistosa);
  h.store.rememberQueuePanel(3, panelId);
  users.slice(0, 10).forEach((user) => h.click(user, 'sap:queuejoin:3'));
  assert.match(h.click(otherHoster, 'sap:draft:3').data.content, /Solo el hoster/);
  assert.equal(h.click(gradedHoster, 'sap:draft:3').data.flags, 64);
  confirmDraft(h, gradedHoster, 3, users.slice(0, 10));
  assert.equal(h.store.pickup({ guild, channel }, 3).status, 'playing');
  assert.ok(h.store.room(3));
  await maintainQueues(h.store, discord, media, { appId: app, roomCategory });
  assert.match(h.slash(gradedHoster, 'pickup', 'calificar', { id: 3 }).data.content, /sin notas/);
  assert.match(h.slash(creator, 'pickup', 'votar', { id: 3 }, roomId).data.content, /sin votación MVP/);
  assert.match(h.slash(creator, 'pickup', 'confirmar', { id: 3 }).data.content, new RegExp(roomId));
  for (const user of users.slice(0, 4)) h.click(user, 'sap:finished:3', undefined, roomId);
  const closed = h.slash(users[4], 'pickup', 'confirmar', { id: 3 }, roomId);
  assert.match(closed.data.embeds[0].title, /Cerrada/);
  assert.equal(h.store.room(3).delete_after, h.store.now());
  await maintainQueues(h.store, discord, media, { appId: app, roomCategory });
  assert.deepEqual(deleted, [roomId]);
  assert.match(edits.findLast(({ message }) => message === panelId).data.embeds[0].title, /Cerrada/);
  assert.deepEqual(edits.findLast(({ message }) => message === panelId).data.components, []);
  assert.deepEqual({ ...h.store.profile(guild, creator) }, { matches: 0, total: 0, wins: 0 });
  assert.deepEqual(h.store.history(guild, creator), []);
  assert.deepEqual(h.store.ranking(guild, 1), []);

  h.store.create({ guild, channel }, 5, legacyRequest);
  assert.match((await h.slash(creator, 'pickup', 'cancelar', { id: 4 })).data.embeds[0].title, /Cancelada/);
});

test('El DM valida al destinatario y los grupos de una cola anterior conservan su lado', async (t) => {
  const invites = [];
  const replies = [];
  const h = harness(t, {
    sendInvite: async (user, id, data) => invites.push({ user, id, data }),
    editReply: async (_, message) => replies.push(message),
    member: async () => ({ roles: [] }),
  });
  const [leader, guest, declined, ...others] = users;
  h.slash(leader, 'party', 'crear', { posicion: 'GK' });
  assert.equal(h.slash(leader, 'grupo', 'ver').data.embeds[0].image.url, media.grupo);
  const sent = h.slash(leader, 'party', 'invitar', { jugador: guest });
  assert.equal(sent.type, 5);
  await sent.afterResponse();
  assert.match(replies[0], /enviada/);
  assert.equal(invites[0].user, guest);
  const [accept, decline] = invites[0].data.components[0].components;
  assert.match(h.dm(declined, accept.custom_id).data.content, /invitación vigente/);
  const picker = h.dm(guest, accept.custom_id).data.components[0].components[0];
  assert.ok(!picker.options.some((option) => option.value === 'GK'));
  await h.dm(guest, picker.custom_id, ['CM']).afterResponse();
  assert.match(replies[1], /Entraste.*CM/);
  assert.match(h.dm(guest, decline.custom_id).data.content, /invitación vigente/);

  await h.slash(leader, 'party', 'invitar', { jugador: declined }).afterResponse();
  assert.match(h.dm(declined, invites[1].data.components[0].components[1].custom_id).data.content, /rechazada/);
  assert.equal(h.store.partyFor({ guild, user: declined }), undefined);
  assert.match(h.slash(guest, 'pickup', 'buscar').data.content, /Solo el líder/);

  h.store.create({ guild, channel, user: users[11] }, 5, 'legacy-party-queue', TEAM_QUEUE_FORMAT);
  const pickup = h.slash(leader, 'pickup', 'buscar').data.embeds[0];
  assert.match(pickup.fields[0].value, new RegExp(leader));
  assert.match(pickup.fields[0].value, new RegExp(guest));
  assert.match(pickup.fields[1].value, /Libre/);
  assert.match(h.click(guest, 'sap:leave:1').data.content, /líder/);
  assert.match(h.slash(guest, 'party', 'posicion', { posicion: 'CF' }).data.content, /cola o partida/);
  h.slash(leader, 'pickup', 'buscar', { equipo: 'B' });
  assert.ok(h.store.roster(1).every((p) => p.team === 'B'));
  h.click(leader, 'sap:leave:1');
  assert.equal(h.store.roster(1).length, 0);
  h.slash(leader, 'pickup', 'buscar', { equipo: 'B' });
  const openPositions = { A: ['Winger', 'Winger', 'GK', 'CM', 'CF'], B: ['Winger', 'Winger', 'CF'] };
  let index = 0;
  for (const [side, positions] of Object.entries(openPositions)) {
    for (const position of positions) assert.equal(h.click([declined, ...others][index++], `sap:join${side}:1`, [position]).type, 7);
  }
  h.slash(users[11], 'pickup', 'iniciar', { id: 1 });
  assert.equal(h.store.pickup({ guild, channel }, 1).status, 'playing');
  assert.ok(h.store.roster(1).filter((player) => player.party_id).every((player) => player.team === 'B'));
});

test('Al vencer la inactividad, se libera el canal y se desactivan los botones del panel guardado', async (t) => {
  const h = harness(t);
  const staff = users[11];
  const idle = QUEUE_IDLE_MINUTES * 60_000;
  h.slash(staff, 'pickup', 'crear');
  assert.match(h.slash(staff, 'pickup', 'cerrar', { id: 1 }).data.content, /Cancelar cola/);
  assert.match(h.click(users[0], 'sap:cancel:1').data.content, /Solo quien abrió/);
  h.store.rememberQueuePanel(1, '610000000000000001');
  h.advance(idle - 1000);
  h.click(users[0], 'sap:queuejoin:1');
  h.advance(1000);
  h.store.expireQueues();
  assert.equal(h.store.pickup({ guild, channel }, 1).status, 'open');
  h.advance(idle - 1000);
  const edits = [];
  await maintainQueues(h.store, { editMessage: async (...args) => edits.push(args) }, media);
  assert.match(edits[0][2].embeds[0].title, /Caducada/);
  assert.equal(edits[0][2].embeds[0].image.url, media['cola-cerrada']);
  assert.deepEqual(edits[0][2].components, []);
  assert.equal(h.click(users[0], 'sap:queuejoin:1').type, 7);
  assert.match(h.slash(staff, 'pickup', 'crear').data.embeds[0].title, /#2/);
  assert.match(h.click(staff, 'sap:cancel:2').data.embeds[0].title, /Cancelada/);
});

test('Dos premades completas de una cola anterior conservan sus reservas por lado', (t) => {
  const h = harness(t);
  const roles = ['GK', 'CM', 'Winger', 'Winger', 'CF'];
  for (const start of [0, 5]) {
    const leader = users[start];
    h.slash(leader, 'party', 'crear', { posicion: roles[0] });
    for (const [offset, position] of roles.slice(1).entries()) {
      const player = users[start + offset + 1];
      assert.match(h.slash(leader, 'party', 'invitar', { jugador: player }).data.content, /aceptar/);
      assert.match(h.slash(player, 'party', 'aceptar', { posicion: position }).data.content, /Entraste/);
    }
  }
  h.store.create({ guild, channel, user: users[11] }, 5, 'legacy-two-groups', TEAM_QUEUE_FORMAT);
  h.slash(users[0], 'pickup', 'buscar');
  assert.match(h.slash(users[5], 'pickup', 'buscar', { equipo: 'A' }).data.content, /todo el grupo en Azul/);
  h.click(users[10], 'sap:joinB:1', ['CM']);
  assert.match(h.slash(users[5], 'pickup', 'buscar').data.content, /todo el grupo/);
  assert.equal(h.store.roster(1).length, 6);
  assert.ok(!h.store.roster(1).some((p) => users.slice(5, 10).includes(p.user_id)));
  h.click(users[10], 'sap:leave:1');
  const card = h.slash(users[5], 'pickup', 'buscar').data.embeds[0];
  assert.match(card.fields[0].name, /Azul · 5\/5/);
  assert.match(card.fields[1].name, /Rojo · 5\/5/);
  h.advance(QUEUE_IDLE_MINUTES * 60_000);
  h.store.expireQueues();
  assert.equal(h.store.pickup({ guild, channel }, 1).status, 'open');
  h.slash(users[11], 'pickup', 'iniciar', { id: 1 });
  assert.deepEqual(h.store.roster(1).filter((p) => p.team === 'B').map((p) => p.user_id), users.slice(5, 10));
});

test('La cola neutral valida puestos repetidos, salidas y reemplazos', (t) => {
  const h = harness(t);
  const staff = users[11];
  const menus = (reply) => reply.data.components.flatMap((r) => r.components).filter((c) => c.type === 3);
  const created = h.slash(staff, 'pickup', 'crear');
  assert.equal(menus(created).length, 0);
  assert.match(h.click(users[0], 'sap:joinA:1', ['GK']).data.content, /Entrar a la cola/);
  const roster = users.slice(0, 10);
  for (const user of roster) h.click(user, 'sap:queuejoin:1');
  assert.equal(h.store.roster(1).length, 0);
  assert.equal(h.store.pickup({ guild, channel }, 1).status, 'open');
  assert.equal(h.slash(staff, 'pickup', 'iniciar', { id: 1 }).data.flags, 64);
  assert.match(h.click(users[0], 'sap:draftpick:1:A0', [users[0]]).data.content, /Solo el hoster/);
  assert.match(h.click(staff, 'sap:draftstart:1').data.content, /10 puestos/);
  assert.equal(menus(h.click(staff, 'sap:draftslot:1', ['A0']))[1].options.length, 10);
  h.click(staff, 'sap:draftpick:1:A0', [users[0]]);
  assert.match(h.click(staff, 'sap:draftpick:1:B1', [users[0]]).data.content, /ya tiene un puesto/);
  h.click(users[0], 'sap:leave:1');
  assert.match(h.click(staff, 'sap:draftpick:1:A0', [users[0]]).data.content, /salió de la cola/);
  h.click(users[0], 'sap:queuejoin:1');
  confirmDraft(h, staff, 1, roster);
  assert.deepEqual(h.store.roster(1).map(({ user_id, team, position }) => [user_id, team, position]),
    DRAFT_SLOTS.map(({ team, position }, i) => [roster[i], team, position]));
  h.slash(staff, 'pickup', 'kick', { id: 1, jugador: users[0] });
  assert.match(h.click(users[0], 'sap:queuejoin:1').data.content, /vetado/);
  assert.match(h.click(staff, 'sap:draftstart:1').data.content, /10 puestos/);
  h.click(users[10], 'sap:queuejoin:1');
  h.click(staff, 'sap:draftpick:1:A0', [users[10]]);
  assert.match(h.click(staff, 'sap:draftstart:1').data.content, /Pickup iniciada/);
  assert.equal(h.store.roster(1)[0].user_id, users[10]);
});
