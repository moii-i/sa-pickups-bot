import assert from 'node:assert/strict';
import test from 'node:test';
import { replyToPickupPing } from '../src/pickup-notices.js';

test('Responde una vez al aviso de pickup y solo en el canal configurado', async () => {
  const sent = [];
  const config = { guildId: 'guild', channelId: 'channel', roleId: 'pickup',
    discord: { sendMessage: (...args) => sent.push(args) } };
  const original = { guild_id: 'guild', channel_id: 'channel', author: { bot: false }, content: '' };

  for (const message of [
    { ...original, id: '1', mention_everyone: true },
    { ...original, id: '2', mention_roles: ['pickup'] },
    { ...original, id: '3', mention_everyone: true, mention_roles: ['pickup'] },
    { ...original, id: '4', mention_roles: ['other'] },
    { ...original, id: '5', channel_id: 'other', mention_everyone: true },
    { ...original, id: '6', guild_id: 'other', mention_everyone: true },
    { ...original, id: '7', author: { bot: true }, mention_everyone: true },
    { ...original, id: '8', webhook_id: 'webhook', mention_everyone: true },
    { ...original, id: '9', content: 'escribió @everyone sin mencionar' },
  ]) await replyToPickupPing(message, config);

  assert.deepEqual(sent, ['1', '2', '3'].map((id) => ['channel', {
    content: 'Usenme /pickup crear', allowed_mentions: { parse: [] }, nonce: id, enforce_nonce: true,
  }]));
});
