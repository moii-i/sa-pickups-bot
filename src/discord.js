export function discordApi(token) {
  async function request(path, method = 'GET', data, timeout = 5000) {
    const multipart = data instanceof FormData;
    const headers = multipart ? {} : { 'content-type': 'application/json' };
    if (!path.startsWith('/webhooks/')) headers.authorization = `Bot ${token}`;
    const response = await fetch(`https://discord.com/api/v10${path}`, {
      method,
      headers,
      body: multipart || data === undefined ? data : JSON.stringify(data),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw Object.assign(new Error(`Discord HTTP ${response.status}`), { status: response.status });
    return response.status === 204 ? undefined : response.json();
  }

  const original = (interaction) => `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
  return {
    originalMessage: (interaction) => request(original(interaction)),
    editReply: (interaction, content) => request(original(interaction), 'PATCH', { content, allowed_mentions: { parse: [] } }),
    member: (guild, user) => request(`/guilds/${guild}/members/${user}`),
    roles: (guild) => request(`/guilds/${guild}/roles`, 'GET', undefined, 1500),
    guildChannels: (guild) => request(`/guilds/${guild}/channels`),
    channel: (channel) => request(`/channels/${channel}`),
    messagesAround: (channel, interactionId) => request(`/channels/${channel}/messages?around=${interactionId}&limit=15`, 'GET', undefined, 1500),
    createChannel: (guild, data) => request(`/guilds/${guild}/channels`, 'POST', data),
    editChannel: (channel, data) => request(`/channels/${channel}`, 'PATCH', data),
    deleteChannel: (channel) => request(`/channels/${channel}`, 'DELETE'),
    sendMessage: (channel, data) => request(`/channels/${channel}/messages`, 'POST', data),
    sendLineup: (channel, data, bytes, message) => {
      const file = new FormData();
      file.set('payload_json', JSON.stringify({ ...data, attachments: [{ id: 0, filename: 'alineacion.gif' }] }));
      file.set('files[0]', new Blob([bytes], { type: 'image/gif' }), 'alineacion.gif');
      return message ? request(`/channels/${channel}/messages/${message}`, 'PATCH', file, 12000)
        : request(`/channels/${channel}/messages`, 'POST', file, 12000);
    },
    editMessage: (channel, message, data) => request(`/channels/${channel}/messages/${message}`, 'PATCH', data),
    async sendInvite(user, invite, data) {
      const channel = await request('/users/@me/channels', 'POST', { recipient_id: user });
      await request(`/channels/${channel.id}/messages`, 'POST', { ...data, nonce: `sap-${invite}`, enforce_nonce: true });
    },
  };
}
