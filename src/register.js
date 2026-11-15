import { applicationCommands } from './commands.js';

const { DISCORD_APP_ID: app, DISCORD_GUILD_ID: guild, DISCORD_BOT_TOKEN: token } = process.env;
if (!/^\d{17,20}$/.test(app) || !/^\d{17,20}$/.test(guild) || !token?.trim()) {
  throw new Error('Configura DISCORD_APP_ID, DISCORD_GUILD_ID y DISCORD_BOT_TOKEN en el entorno local.');
}

const url = `https://discord.com/api/v10/applications/${app}/guilds/${guild}/commands`;
const headers = { authorization: `Bot ${token.trim()}`, 'content-type': 'application/json' };
async function request(path = '', method = 'GET', command) {
  const response = await fetch(`${url}${path}`, { method, headers,
    body: command ? JSON.stringify(command) : undefined, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Discord respondió HTTP ${response.status}: ${JSON.stringify(error)}`);
  }
  return response.status === 204 ? undefined : response.json();
}

for (const command of applicationCommands) {
  await request('', 'POST', command);
  console.log(`Registré /${command.name} en el servidor configurado.`);
}
const legacy = (await request()).find((command) => command.type === 1 && command.name === 'party');
if (legacy) {
  await request(`/${legacy.id}`, 'DELETE');
  console.log('Reemplacé /party por /grupo.');
}
