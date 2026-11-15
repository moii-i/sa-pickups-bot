import { card } from './interactions.js';
import { PARTY_BADGES } from './arcade.js';
import { lineupParties, lineupPlayers } from './lineup-scene.js';
import { renderLineupGif } from './lineup-viewer.js';
import { ROOM_RETENTION_HOURS, TEAM_NAMES } from './rules.js';

const VIEW_CHANNEL = 1n << 10n;
const PLAYER_PERMISSIONS = VIEW_CHANNEL | (1n << 11n) | (1n << 16n) | (1n << 31n);
const roomTopic = (guild, id) => `sa-pickups:room:${guild}:${id}`;

function roomOverwrites(guild, app, users) {
  return [
    { id: guild, type: 0, allow: '0', deny: String(VIEW_CHANNEL) },
    ...[...new Set([app, ...users])].map((id) => ({ id, type: 1, allow: String(PLAYER_PERMISSIONS), deny: '0' })),
  ];
}

function hasRoomPrivacy(channel, expected) {
  const actual = channel.permission_overwrites ?? [];
  return actual.length === expected.length && expected.every((entry) => actual.some((permission) =>
    entry.id === permission.id && entry.type === permission.type && entry.allow === permission.allow && entry.deny === permission.deny));
}

async function findRoom(discord, guild, topic, channelId) {
  if (channelId) {
    try {
      const channel = await discord.channel(channelId);
      if (channel.guild_id !== guild || channel.type !== 0 || channel.topic !== topic) throw new Error('La sala guardada ya no pertenece a la pickup.');
      return channel;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  return (await discord.guildChannels(guild)).find((channel) => channel.type === 0 && channel.topic === topic);
}

async function clearOldLineup(store, discord, pickup, channel, appId) {
  let message = pickup.lineup_message_id;
  if (!message && pickup.room_version === 0 && discord.messagesAround) {
    const recent = await discord.messagesAround(channel, channel);
    message = recent.find((item) => item.author?.id === appId && item.components?.some((row) =>
      row.components?.some((button) => button.custom_id === `sap:lineup:${pickup.id}`)))?.id;
  }
  if (!message) return;
  try {
    await discord.editMessage(channel, message, {
      embeds: [{ title: `🎮 Alineación #${pickup.id} · En actualización` }],
      components: [], attachments: [],
    });
    store.rememberLineupMessage(pickup.id, message);
  } catch (error) {
    if (error.status !== 404) throw error;
    store.rememberLineupMessage(pickup.id, null);
  }
}

export async function maintainRooms(store, discord, media, { appId, roomCategory, lineupViewer }) {
  for (const room of store.expiredRooms()) {
    try {
      const channel = await findRoom(discord, room.guild_id, roomTopic(room.guild_id, room.pickup_id), room.channel_id);
      if (channel) await discord.deleteChannel(channel.id).catch((error) => {
        if (error.status !== 404) throw error;
      });
      store.forgetRoom(room.pickup_id);
    } catch (error) {
      console.error(`No pude retirar la sala de la pickup #${room.pickup_id}:`, error.message);
    }
  }
  for (const pickup of store.pendingRooms()) {
    try {
      const topic = roomTopic(pickup.guild_id, pickup.id);
      const users = store.roster(pickup.id).map((player) => player.user_id);
      const permission_overwrites = roomOverwrites(pickup.guild_id, appId, users);
      const existing = await findRoom(discord, pickup.guild_id, topic, pickup.room_channel_id);
      if (!existing && pickup.status === 'open') {
        store.markRoomSynced(pickup.id, pickup.roster_version);
        continue;
      }
      let channel = existing ?? await discord.createChannel(pickup.guild_id, {
        name: `pickup-${pickup.id}`, type: 0, parent_id: roomCategory, topic, permission_overwrites,
      });
      store.saveRoomChannel(pickup.id, channel.id);
      if (existing && pickup.roster_version !== pickup.room_version && !hasRoomPrivacy(channel, permission_overwrites)) {
        channel = await discord.editChannel(channel.id, { permission_overwrites });
      }
      if (!hasRoomPrivacy(channel, permission_overwrites)) throw new Error('Discord no confirmó los permisos privados de la sala.');
      if (!existing && pickup.lineup_message_id) store.rememberLineupMessage(pickup.id, null);
      if (existing && pickup.roster_version !== pickup.room_version) {
        await clearOldLineup(store, discord, pickup, channel.id, appId);
      }
      store.markRoomSynced(pickup.id, pickup.roster_version);
      const synced = store.room(pickup.id);
      if (synced.delete_after !== null || synced.roster_version !== pickup.roster_version) continue;
      const current = store.pickup({ guild: pickup.guild_id, channel: channel.id }, pickup.id);
      if (!['playing','voting'].includes(current.status) || synced.announced) continue;
      const { embeds, components } = card(store, current, 4, media, channel.id).data;
      const message = await discord.sendMessage(channel.id, {
        content: `${users.map((id) => `<@${id}>`).join(' ')}\n\n` +
          '**⚽ ¡Pickup completa!** Compartan aquí el enlace de su servidor privado de **Blue Lock Rivals**.\n' +
          (pickup.friendly ? 'La sala se retira al terminar la amistosa.'
            : `Esta sala se retirará ${ROOM_RETENTION_HOURS} horas después de cerrar o cancelar la pickup.`),
        embeds, components,
        allowed_mentions: { users },
        nonce: pickup.roster_version ? `sap-r-${pickup.id.toString(36)}-${pickup.roster_version.toString(36)}` : `sap-room-${pickup.id}`,
        enforce_nonce: true,
      });
      store.rememberQueuePanel(pickup.id, message.id, channel.id, current.status);
      store.markRoomAnnounced(pickup.id, pickup.roster_version);
    } catch (error) {
      console.error(`No pude preparar la sala de la pickup #${pickup.id}:`, error.message);
    }
  }
  if (!lineupViewer) return;
  for (const pickup of store.lineupsToPublish()) {
    try {
      const roster = store.roster(pickup.id);
      const players = lineupPlayers(roster);
      const parties = lineupParties(roster);
      const bytes = await renderLineupGif(players, parties);
      const active = store.activeLineup(pickup.guild_id, pickup.id);
      if (active?.roster_version !== pickup.roster_version) continue;
      const message = await discord.sendLineup(pickup.channel_id, {
        embeds: [{
          title: `🎮 Presentación de equipos · Pickup #${pickup.id}`,
          description: '🔵 **Azul** · 🔴 **Rojo**\nMira el dorsal y la posición de cada jugador. Abre el visor 3D y confirma su código desde esta sala.',
          ...(parties.length ? { fields: Object.entries(TEAM_NAMES).flatMap(([side, name]) => {
            const groups = parties.filter((p) => p.side === side);
            return groups.length ? [{ name: `Grupos · ${name}`, value: groups.map((p) => `${PARTY_BADGES[p.badge].icon} **${p.name}**`).join('\n'), inline: true }] : [];
          }) } : {}),
          color: 0xe8e8e8,
          image: { url: 'attachment://alineacion.gif' },
          footer: { text: 'SA PICKUPS · ARCADE' },
        }],
        components: [{ type: 1, components: [
          { type: 2, style: 5, label: 'Abrir visor 3D', url: lineupViewer.urlFor(pickup.id) },
          { type: 2, style: 2, label: 'Autorizar visor', custom_id: `sap:lineup:${pickup.id}` },
        ] }],
        ...(!pickup.lineup_message_id && { nonce: `sap-lineup-${pickup.id}`, enforce_nonce: true }),
        allowed_mentions: { parse: [] },
      }, bytes, pickup.lineup_message_id);
      if (message?.id) store.rememberLineupMessage(pickup.id, message.id);
      store.markLineupPosted(pickup.id, pickup.roster_version);
    } catch (error) {
      if (error.status === 404 && pickup.lineup_message_id) store.rememberLineupMessage(pickup.id, null);
      console.error(`No pude publicar la alineación #${pickup.id}:`, error.message);
    }
  }
}
