import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { card, handleInteraction } from './interactions.js';
import { discordApi } from './discord.js';
import { createLineupViewer } from './lineup-viewer.js';
import { ARCADE_PATHS, arcadeUrls } from './media.js';
import { startPickupNotices } from './pickup-notices.js';
import { maintainRooms } from './rooms.js';
import { PickupStore } from './store.js';

const SNOWFLAKE = /^\d{17,20}$/;
const isSnowflake = (id) => typeof id === 'string' && SNOWFLAKE.test(id);
const MAX_BODY = 65_536;
const ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const gifs = new Map(Object.values(ARCADE_PATHS)
  .map((path) => [path, readFileSync(new URL('..' + path, import.meta.url))]));

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function rememberPanel(store, discord, interaction, queueId) {
  if (interaction.message?.id) {
    store.rememberQueuePanel(queueId, interaction.message.id);
    return;
  }
  if (!interaction.token) return;
  for (const wait of [250, 750, 1500]) {
    await delay(wait);
    try {
      const message = await discord.originalMessage(interaction);
      store.rememberQueuePanel(queueId, message.id);
      return;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
}

export async function maintainQueues(store, discord, media, config = {}) {
  store.expireQueues();
  if (!discord) return;
  for (const guild of [config, ...(config.additionalGuilds?.values() ?? [])]) {
    if (guild.roomCategory) await maintainRooms(store, discord, media, guild);
  }
  for (const pickup of store.queuePanelsToSync()) {
    try {
      await discord.editMessage(pickup.panel_channel_id, pickup.message_id,
        card(store, pickup, 4, media, pickup.panel_channel_id).data);
    } catch (error) {
      if (error.status !== 404 && error.status !== 403) throw error;
      store.forgetQueuePanel(pickup.message_id);
      continue;
    }
    if (pickup.status === 'open' || pickup.tracked_room && ['playing', 'voting'].includes(pickup.status)) {
      store.markQueuePanelSynced(pickup.message_id, pickup.status);
    } else {
      store.forgetQueuePanel(pickup.message_id);
    }
  }
}

export function interactionHandler(store, config) {
  const key = createPublicKey({
    key: Buffer.concat([ED25519_PREFIX, Buffer.from(config.publicKey, 'hex')]),
    format: 'der',
    type: 'spki',
  });
  return async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok' });
    if (config.lineupViewer?.serve(req, res)) return;
    const gif = gifs.get(req.url);
    if (gif && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { 'content-type': 'image/gif', 'content-length': gif.length, 'cache-control': 'public, max-age=86400' });
      return res.end(req.method === 'HEAD' ? undefined : gif);
    }
    if (req.method !== 'POST' || req.url !== '/discord/interactions') {
      return json(res, 404, { error: 'not found' });
    }

    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];
    if (!/^[\da-f]{128}$/i.test(signature ?? '') || !/^\d{10}$/.test(timestamp ?? '') ||
        Math.abs(Date.now() - Number(timestamp) * 1000) > 300_000) {
      return json(res, 401, { error: 'invalid signature' });
    }

    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > MAX_BODY) {
          res.setHeader('connection', 'close');
          return json(res, 413, { error: 'request too large' });
        }
        chunks.push(chunk);
      }
    } catch {
      return;
    }

    const body = Buffer.concat(chunks);
    const signed = Buffer.concat([Buffer.from(timestamp), body]);
    if (!verify(null, signed, key, Buffer.from(signature, 'hex'))) {
      return json(res, 401, { error: 'invalid signature' });
    }
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      return json(res, 400, { error: 'invalid JSON' });
    }
    try {
      const guildConfig = config.additionalGuilds?.get(payload?.guild_id) ?? config;
      const { afterResponse, queueId, ...reply } = await handleInteraction(payload, store, guildConfig);
      json(res, 200, reply);
      if (afterResponse) void afterResponse().catch((error) => console.error('Discord party reply failed:', error.name, error.message));
      if (queueId && config.discord) {
        void rememberPanel(store, config.discord, payload, queueId).catch((error) => console.error('Queue panel failed:', error.name, error.message));
      }
    } catch (error) {
      console.error('Discord interaction failed:', error.name, error.message);
      return json(res, 200, {
        type: 4,
        data: { content: 'Ocurrió un error. Consulta el estado con /pickup ver antes de reintentar.', flags: 64 },
      });
    }
  };
}

function readAdditionalGuilds(value, config) {
  const entries = value ? JSON.parse(value) : [];
  if (!Array.isArray(entries)) throw new Error('DISCORD_ADDITIONAL_GUILDS debe ser una lista JSON.');
  const guilds = new Map();
  for (const entry of entries) {
    const { guildId, channels, roomCategory, hosterRole = 'Hoster', staffRole, playerRole, cancelRoles = [] } = entry ?? {};
    if (!isSnowflake(guildId) || guildId === config.guildId || guilds.has(guildId) ||
        !Array.isArray(channels) || !channels.length || !Array.isArray(cancelRoles) ||
        [...channels, ...cancelRoles, ...[roomCategory, staffRole, playerRole].filter(Boolean)].some((id) => !isSnowflake(id)) ||
        typeof hosterRole !== 'string' || !hosterRole.trim() || !config.discord) {
      throw new Error('Revisa el servidor, sus canales y sus roles en DISCORD_ADDITIONAL_GUILDS.');
    }
    guilds.set(guildId, { ...config, guildId, channels, roomCategory, hosterRole: hosterRole.trim(), staffRole, playerRole,
      cancelRoles, adminCanHost: true, noticeChannel: undefined, noticeRole: undefined });
  }
  return guilds;
}

function configFromEnv(env) {
  const appId = env.DISCORD_APP_ID?.trim();
  const guildId = env.DISCORD_GUILD_ID?.trim();
  const publicKey = env.DISCORD_PUBLIC_KEY?.trim();
  const staffRole = env.STAFF_ROLE_ID?.trim();
  const hosterRole = env.PICKUP_HOSTER_ROLE?.trim() || 'Hoster';
  const cancelRoles = (env.PICKUP_CANCEL_ROLE_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  const playerRole = env.PLAYER_ROLE_ID?.trim();
  const roomCategory = env.PICKUP_ROOM_CATEGORY_ID?.trim();
  const channels = (env.PICKUP_CHANNEL_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  const noticeChannel = env.PICKUP_NOTICE_CHANNEL_ID?.trim();
  const noticeRole = env.PICKUP_NOTICE_ROLE_ID?.trim();
  if (!SNOWFLAKE.test(appId) || !SNOWFLAKE.test(guildId)) {
    throw new Error('Configura DISCORD_APP_ID y DISCORD_GUILD_ID.');
  }
  if (!/^[\da-f]{64}$/i.test(publicKey ?? '')) throw new Error('Configura DISCORD_PUBLIC_KEY.');
  if ([staffRole, playerRole, roomCategory, noticeChannel, noticeRole, ...cancelRoles, ...channels]
      .filter(Boolean).some((id) => !SNOWFLAKE.test(id))) {
    throw new Error('Revisa los IDs de roles y canales.');
  }
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (roomCategory && !token) throw new Error('Configura DISCORD_BOT_TOKEN para crear salas privadas.');
  if ((noticeChannel || noticeRole) && (!noticeChannel || !noticeRole || !token)) {
    throw new Error('Configura el canal, el rol y el token de Discord para los avisos de pickup.');
  }
  const config = { appId, guildId, publicKey, staffRole, hosterRole, cancelRoles, playerRole, channels, roomCategory,
    noticeChannel, noticeRole, token,
    discord: token ? discordApi(token) : undefined, media: arcadeUrls(env.PUBLIC_BASE_URL?.trim()),
    publicBaseUrl: env.PUBLIC_BASE_URL?.trim() };
  config.additionalGuilds = readAdditionalGuilds(env.DISCORD_ADDITIONAL_GUILDS, config);
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = configFromEnv(process.env);
  const dbPath = process.env.DB_PATH || './data/pickups.sqlite';
  const store = new PickupStore(dbPath, Date.now, process.env.DB_ENCRYPTION_KEY);
  const guilds = [config, ...config.additionalGuilds.values()];
  const withRooms = guilds.filter((guild) => guild.roomCategory);
  if (withRooms.length && config.publicBaseUrl) {
    const viewer = createLineupViewer(store, withRooms.map((guild) => guild.guildId), config.publicBaseUrl);
    config.lineupViewer = viewer;
    for (const guild of withRooms) guild.lineupViewer = viewer;
  }
  const port = Number(process.env.PORT || 3000);
  const server = createServer({ requestTimeout: 10_000 }, interactionHandler(store, config));
  server.listen(port, '0.0.0.0', () => console.log(`SA Pickups escuchando en el puerto ${port}. Servidores configurados: ${guilds.length}.`));
  const stopNotices = config.noticeChannel ? startPickupNotices(config.token, {
    guildId: config.guildId, channelId: config.noticeChannel, roleId: config.noticeRole, discord: config.discord,
  }) : undefined;
  let updatingQueues = false;
  const updateQueues = async () => {
    if (updatingQueues) return;
    updatingQueues = true;
    try {
      await maintainQueues(store, config.discord, config.media, config);
    } catch (error) {
      console.error('Queue maintenance failed:', error.name, error.message);
    } finally {
      updatingQueues = false;
    }
  };
  void updateQueues();
  const timer = setInterval(updateQueues, withRooms.length ? 5_000 : 15_000).unref();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      clearInterval(timer);
      stopNotices?.();
      server.close(() => store.db.close());
    });
  }
}
