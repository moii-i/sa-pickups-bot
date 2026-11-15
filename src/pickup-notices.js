import { REST } from '@discordjs/rest';
import { WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';

const GUILD_MESSAGES = 1 << 9;

export async function replyToPickupPing(message, { guildId, channelId, roleId, discord }) {
  if (message.guild_id !== guildId || message.channel_id !== channelId ||
      !message.author || message.author.bot || message.webhook_id) return;
  if (!message.mention_everyone && !message.mention_roles?.includes(roleId)) return;

  await discord.sendMessage(channelId, {
    content: 'Usenme /pickup crear',
    allowed_mentions: { parse: [] },
    nonce: message.id,
    enforce_nonce: true,
  });
}

export function startPickupNotices(token, config) {
  const rest = new REST({ version: '10' }).setToken(token);
  const gateway = new WebSocketManager({ token, rest, intents: GUILD_MESSAGES });
  let stopping = false;
  let retry;

  gateway.on(WebSocketShardEvents.Ready, () => console.log('Avisos de pickups conectados a Discord.'));
  gateway.on(WebSocketShardEvents.Error, (error) => console.error('Conexión de avisos:', error.name));
  gateway.on(WebSocketShardEvents.Dispatch, (data) => {
    if (stopping || data.t !== 'MESSAGE_CREATE') return;
    void replyToPickupPing(data.d, config)
      .catch((error) => console.error('Respuesta al aviso de pickup:', error.message));
  });

  async function connect() {
    try {
      await gateway.connect();
    } catch (error) {
      if (stopping) return;
      console.error('No se pudo conectar el servicio de avisos:', error.message);
      retry = setTimeout(connect, 30_000).unref();
    } finally {
      if (stopping) await gateway.destroy();
    }
  }
  void connect();

  return () => {
    stopping = true;
    clearTimeout(retry);
    void gateway.destroy();
  };
}
