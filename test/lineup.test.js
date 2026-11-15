import assert from 'node:assert/strict';
import test from 'node:test';
import { handleInteraction } from '../src/interactions.js';
import { createLineupViewer } from '../src/lineup-viewer.js';
import { maintainQueues } from '../src/server.js';
import { TEAM_QUEUE_FORMAT } from '../src/rules.js';
import { PickupStore } from '../src/store.js';

test('La sala recibe una alineación animada y el visor verifica quién juega', async (t) => {
  const guild = '200000000000000001';
  const origin = '200000000000000002';
  const room = '200000000000000003';
  const appId = '200000000000000004';
  const user = '400000000000000001';
  const store = new PickupStore(':memory:');
  t.after(() => store.db.close());
  const pickup = store.create({ guild, channel: origin, user }, 5, 'test', TEAM_QUEUE_FORMAT, true);
  const captain = { guild, channel: origin, user, name: 'Jugador 00' };
  store.createParty(captain, 'GK');
  store.setPartyIdentity(captain, 'Fuego Azul', 'llama');
  store.queueParty(captain, 'test-group', 'A');
  const positions = ['GK','Winger','CM','Winger','CF'];
  for (const [side, team] of ['A','B'].entries()) {
    for (const [index, position] of positions.entries()) {
      if (side === 0 && index === 0) continue;
      const member = String(BigInt(user) + BigInt(5*side + index));
      store.enroll({ guild, channel: origin, user: member, name: `Jugador ${side}${index}` }, pickup, position, team);
    }
  }
  store.transaction(() => store.startFilledRoom(pickup));
  store.saveRoomChannel(pickup.id, room);
  store.markRoomAnnounced(pickup.id);
  const lineupViewer = createLineupViewer(store, guild, 'https://example.test');
  const topRole = '300000000000000001';
  const config = { appId, guildId: guild, channels: [origin], lineupViewer, roomCategory: '200000000000000005', cancelRoles: [topRole] };
  const sends = [];
  const edits = [];
  const originalPanel = '600000000000000001';
  const lineupMessage = '600000000000000002';
  let roomChannel = { id: room, type: 0, guild_id: guild, topic: `sa-pickups:room:${guild}:1` };
  const discord = {
    sendLineup: async (...args) => { sends.push(args); return { id: lineupMessage }; },
    editChannel: async (id, patch) => {
      assert.equal(id, room);
      return roomChannel = { ...roomChannel, ...patch };
    },
    channel: async () => roomChannel,
    editMessage: async (id, messageId, data) => { edits.push({ id, messageId, data }); },
    sendMessage: async () => ({ id: '600000000000000003' }),
  };
  store.rememberQueuePanel(pickup.id, originalPanel);
  const maintain = () => maintainQueues(store, discord, {}, config);
  await maintain();
  await maintain();
  assert.equal(sends.length, 1);
  const [channel, message, file] = sends[0];
  assert.equal(channel, room);
  assert.equal(Buffer.from(file).subarray(0,6).toString(), 'GIF89a');
  assert.equal(message.embeds[0].image.url, 'attachment://alineacion.gif');
  assert.match(message.embeds[0].fields[0].value, /🔥 \*\*Fuego Azul\*\*/);
  assert.equal(message.components[0].components[0].url, 'https://example.test/alineacion/1');
  assert.equal(message.enforce_nonce, true);

  function get(path, cookie) {
    const output = {};
    assert.ok(lineupViewer.serve({ method:'GET', url: path, headers:{cookie} }, {
      writeHead(status, headers) { Object.assign(output,{status,headers}); },
      end(body) { output.body = body.toString(); },
    }));
    return output;
  }
  function interact(player, source, code) {
    return handleInteraction({
      application_id: appId, guild_id:guild, channel_id:source,
      type: code ? 5 : 3, member: { user: { id:player, username:'Jugador' } },
      data: { custom_id:'sap:lineup:1', components: code ? [{ component:{ custom_id:'code', value:code } }] : undefined },
    }, store, config);
  }
  const path = '/alineacion/1';
  const page = get(path);
  assert.equal(page.status, 200);
  assert.match(page.headers['Set-Cookie'], /Secure; HttpOnly/);
  assert.doesNotMatch(page.body, /Jugador 00/);
  const cookie = page.headers['Set-Cookie'].split(';')[0];
  const forwardedCookie = get(path).headers['Set-Cookie'].split(';')[0];
  const { code } = JSON.parse(get(path+'/datos', cookie).body);
  assert.match(code, /^[A-F0-9]{8}$/);
  assert.equal(interact(user, room).type, 9);
  assert.match(interact('400000000000000999', room, code).data.content, /Solo los jugadores/);
  assert.match(interact(user, origin, code).data.content, /Solo los jugadores/);
  assert.match(interact(user, room, code).data.content, /Visor autorizado/);
  assert.match(interact(user, room, code).data.content, /ya venció/);
  const data = JSON.parse(get(path+'/datos', cookie).body);
  assert.equal(data.players.length, 10);
  assert.deepEqual(data.players[0], { team:'A', position:'GK', label:'Jugador 00', number:1 });
  assert.deepEqual(data.players.filter((p) => p.team === 'A' && p.position === 'Winger').map((p) => p.number), [7, 11]);
  assert.deepEqual(data.parties, [{ side: 'A', name: 'Fuego Azul', badge: 'llama' }]);
  assert.equal(JSON.parse(get(path+'/datos', forwardedCookie).body).players, undefined);
  const removed = String(BigInt(user) + 4n);
  const replacement = '400000000000000050';
  const director = '400000000000000099';
  const sendAction = (player, source, type, data, roles = []) => handleInteraction({
    application_id: appId, guild_id: guild, channel_id: source, type,
    member: { user: { id: player, username: player === replacement ? 'Reemplazo' : 'Jugador' }, roles, permissions:'8' },
    data,
  }, store, config);
  const kick = { name:'pickup', options:[{name:'kick', options:[{name:'id',value:1},{name:'jugador',value:removed}]}] };
  const join = { custom_id:'sap:joinA:1', values:['CF'] };
  const removedCookie = get(path).headers['Set-Cookie'].split(';')[0];
  const removedCode = JSON.parse(get(path+'/datos', removedCookie).body).code;
  assert.match(interact(removed, room, removedCode).data.content, /Visor autorizado/);
  store.voteFinished(store.pickup({ guild, channel: origin }, 1), removed);
  assert.match(sendAction(removed, room, 2, kick).data.content, /Solo quien abrió/);
  const openKickMenu = { custom_id: 'sap:kickmenu:1' };
  const selectKick = { custom_id: 'sap:kickselect:1', values: [removed] };
  assert.match(sendAction(removed, room, 3, openKickMenu).data.content, /Solo quien abrió/);
  assert.match(sendAction(removed, room, 3, selectKick).data.content, /Solo quien abrió/);
  const menu = sendAction(director, room, 3, openKickMenu, [topRole]);
  assert.equal(menu.data.flags, 64);
  const [select] = menu.data.components[0].components;
  assert.deepEqual(select.options.map((player) => player.value), store.roster(1).map((player) => player.user_id));
  assert.deepEqual(select.options.find((player) => player.value === removed), {
    label: 'Jugador 04', value: removed, description: 'Azul · Delantero (CF)',
  });
  const kicked = sendAction(director, room, 3, selectKick, [topRole]);
  assert.equal(kicked.type, 7);
  assert.match(kicked.data.content, /quedó vetado/);
  assert.deepEqual(kicked.data.components, []);
  assert.match(sendAction(director, room, 3, selectKick, [topRole]).data.content, /no está en la alineación/);
  assert.equal(store.pickup({ guild, channel: origin }, 1).status, 'open');
  assert.equal(store.finishedProgress(pickup).count, 0);
  assert.equal(store.roster(1).length, 9);
  assert.match(sendAction(removed, origin, 3, join).data.content, /Fuiste vetado/);
  const group = { guild, channel: origin, user: removed, name: 'Jugador vetado' };
  const party = store.createParty(group, 'CF');
  assert.throws(() => store.queueParty(group, 'party-search', 'A'), /grupo fue vetado/);
  store.leaveParty(group, party);
  const otherChannel = '200000000000000006';
  const other = store.create({ guild, channel:otherChannel, user }, 5, 'other', TEAM_QUEUE_FORMAT);
  store.enroll({ guild, channel:otherChannel, user:removed, name:'Jugador' }, other, 'CF', 'A');
  assert.equal(store.roster(other.id).length, 1);
  assert.equal(get(path+'/datos', removedCookie).status, 404);
  assert.equal(get(path+'/datos', cookie).status, 409);
  await maintain();
  assert.ok(!roomChannel.permission_overwrites.some(({id}) => id === removed));
  assert.deepEqual(edits.findLast((edit) => edit.messageId === lineupMessage).data.attachments, []);
  assert.match(edits.findLast((edit) => edit.messageId === originalPanel).data.embeds[0].description, /9\/10/);
  sendAction(replacement, origin, 3, join);
  assert.equal(store.pickup({ guild, channel:origin }, 1).status, 'playing');
  assert.equal(get(path+'/datos', cookie).status, 409);
  await maintain();
  assert.ok(roomChannel.permission_overwrites.some(({id}) => id === replacement));
  assert.equal(sends.length, 2);
  assert.equal(sends[1][3], lineupMessage);
  assert.ok(JSON.parse(get(path+'/datos', cookie).body).players.some(({label}) => label === 'Reemplazo'));
  assert.equal(JSON.parse(get(path+'/datos', removedCookie).body).players, undefined);

  const beforeKick = store.pickup({ guild, channel:otherChannel }, other.id);
  assert.equal(beforeKick.status, 'open');
  const removeInQueue = { name:'pickup', options:[{name:'kick', options:[{name:'id',value:other.id},{name:'jugador',value:removed}]}] };
  const response = handleInteraction({
    type:2, application_id:appId, guild_id:guild, channel_id:otherChannel,
    member:{user:{id:user,username:'Creador'}}, data:removeInQueue,
  }, store, { ...config, channels:[origin,otherChannel] });
  assert.match(response.data.content, /quedó vetado/);
  assert.equal(store.roster(other.id).length, 0);
  store.close(store.pickup({ guild, channel:origin }, pickup.id));
  assert.equal(get(path+'/datos', cookie).status, 404);
});
