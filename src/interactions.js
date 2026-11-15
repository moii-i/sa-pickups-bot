import { DEFAULT_TEAM_SIZE, DRAFT_QUEUE_FORMAT, DRAFT_QUEUE_LIMIT, DRAFT_SLOTS, MIN_MATCHES, OUTCOMES, POSITIONS, POSITION_MARKERS, POSITION_NAMES, QUEUE_IDLE_MINUTES, TEAM_NAMES, TEAM_QUEUE_FORMAT, PickupCreationRequired, PickupError, gradeInTenths, rankFor } from './rules.js';
import { PARTY_BADGES, PROFILE_REWARDS } from './arcade.js';
import { lineupParties } from './lineup-scene.js';

const STAFF_PERMISSIONS = (1n << 3n) | (1n << 5n); // Administrator or Manage Guild.
const STAFF = new Set(['iniciar', 'terminar', 'finalizar', 'calificar', 'cerrar']);
const STAGES = {
  open: ['Convocatoria abierta', 0x3d8bfd, '📣', 'convocatoria'],
  playing: ['En juego', 0xf0ad45, '⚽', 'en-juego'],
  voting: ['Evaluación y MVP', 0x825ee4, '🗳️', 'mvp'],
  closed: ['Cerrada', 0x39ad79, '🏁', 'cierre'],
  canceled: ['Cancelada', 0x808995, '🛑', 'cola-cerrada'],
};
const TEAM_MARKERS = { A: '🔵', B: '🔴' };
const row = (...components) => ({ type: 1, components });
const button = (label, action, id, style = 2, icon) => ({
  type: 2, custom_id: `sap:${action}:${id}`, label, style,
  ...(icon ? { emoji: { name: icon } } : {}),
});
const mention = (id) => `<@${id}>`;
const embedMedia = (url, field = 'image') => url ? { [field]: { url } } : {};
const positionLabel = (position) => `${POSITION_NAMES[position]} (${position})`;
const freeSlots = (count) => count === 1 ? '1 cupo libre' : `${count} cupos libres`;
const privateReply = (content, components = []) => ({
  type: 4, data: { content, components, flags: 64, allowed_mentions: { parse: [] } },
});
const stars = (total, matches) => {
  const rank = rankFor(total, matches);
  return rank ? '⭐'.repeat(rank) : `En clasificación (${matches}/${MIN_MATCHES})`;
};

function help(artwork, privateRooms) {
  return { type: 4, data: { flags: 64, embeds: [{
    title: '🎮 SA Pickups · Guía rápida',
    description: 'Juega fútbol competitivo **5v5**, gana estrellas y escala en la clasificación. Empieza en un canal de pickups.',
    color: 0x825ee4,
    ...embedMedia(artwork),
    fields: [
      { name: '⚽ 1. Entra a una partida', value: [
        'Pulsa **Entrar a la cola**. El hoster que la abrió o un administrador elige a los diez titulares y les asigna equipo y posición.',
        '`/pickup ver id:12` vuelve a mostrar la ficha. Escribe el número sin `#`.',
        ...(privateRooms ? ['Si quedaste en la alineación, pulsa **Ir a la sala privada**. Comparte allí el enlace del servidor privado de Blue Lock Rivals.'] : []),
      ].join('\n') },
      { name: '🏅 2. Confirma el fin y vota MVP', value: [
        'En la sala privada, pulsa **Confirmar fin**. Cinco confirmaciones abren el voto en competitivas o cierran la amistosa y retiran su sala.',
        'En competitivas, pulsa **Votar MVP** en la sala y elige a otro participante. Tu voto es privado y puedes cambiarlo hasta que cierre.',
      ].join('\n') },
      { name: '👥 Juega con tu grupo', value: [
        '`/grupo crear` para elegir tu posición y `/grupo invitar` para sumar jugadores.',
        'Responde en el mensaje privado o usa `/grupo aceptar` o `/grupo rechazar` en el servidor.',
        '`/grupo ver` muestra el equipo, `/grupo posicion` cambia tu puesto y `/grupo salir` te saca del grupo.',
        'El líder puede elegir el nombre y escudo con `/grupo identidad` antes de entrar a una cola.',
        'El líder usa `/pickup buscar` para anotar al grupo en la cola. Abrir una cola nueva requiere **Hoster** o superior.',
      ].join('\n') },
      { name: '⭐ Presume tus resultados', value: [
        '`/perfil` publica tu tarjeta. Pulsa **Personalizar mi tarjeta** para elegir posición favorita, marco y título.',
        'Tu primer MVP, cinco victorias y tres victorias seguidas desbloquean estilos para tu tarjeta.',
        `\`/clasificacion\` muestra el top 15 por promedio. Las notas se suman al cerrar la partida y el rango aparece tras **${MIN_MATCHES} pickups cerradas**.`,
      ].join('\n') },
      { name: '📋 Hoster y organización', value: [
        '**Hoster o superior** · `/pickup crear` abre la convocatoria. Elige **Amistosa (sin nota)** en `modo` para jugar sin MVP ni historial.',
        '**Hoster de la pickup o administrador** · Pulsa **Organizar equipos** o usa `/pickup iniciar` para asignar los puestos e iniciar.',
        '`/pickup terminar` guarda el marcador Azul–Rojo. `/pickup calificar` captura notas de 0 a 10.',
        '`/pickup cerrar` publica la evaluación. Una amistosa termina con cinco confirmaciones o cuando el creador o la organización usa ese comando.',
        '**Cancelar cola** o `/pickup cancelar` · Solo quien abrió la pickup o los roles de dirección autorizados.',
        '**Retirar jugador** o `/pickup kick` · Creador o dirección. Libera el cupo y veta al jugador para esa pickup.',
        `Las colas caducan tras **${QUEUE_IDLE_MINUTES} min** sin actividad.`,
      ].join('\n') },
    ],
    footer: { text: 'SA PICKUPS · FÚTBOL COMPETITIVO 5V5' },
  }] } };
}

function provisionalTeams(roster) {
  const teams = Object.fromEntries(Object.keys(TEAM_NAMES).map((side) => [side, roster.filter((p) => p.party_id && p.team === side)]));
  for (const player of roster.filter((p) => !p.party_id)) {
    const side = Object.keys(teams).find((key) => teams[key].filter((p) => p.position === player.position).length < POSITIONS[player.position] / 2);
    teams[side].push(player);
  }
  return teams;
}

function signupLineups(teams) {
  return Object.entries(TEAM_NAMES).map(([side, team]) => ({
    name: `${TEAM_MARKERS[side]} Equipo ${team} · ${teams[side].length}/5${teams[side].length === 5 ? ' ✅' : ''}`,
    value: Object.entries(POSITIONS).flatMap(([position, limit]) => {
      const players = teams[side].filter((p) => p.position === position);
      return Array.from({ length: limit / 2 }, (_, index) => {
        const p = players[index];
        const label = p ? `${mention(p.user_id)}${p.party_id ? ' 👥' : ''}` : '· Libre';
        return `${POSITION_MARKERS[position]} **${POSITION_NAMES[position]}** ${label}`;
      });
    }).join('\n'),
  }));
}

function positionMenu(id, action, placeholder, available) {
  return row({
    type: 3, custom_id: `sap:${action}:${id}`, placeholder,
    options: available.map(({ position, free }) => ({
      label: positionLabel(position), value: position, description: freeSlots(free), emoji: { name: POSITION_MARKERS[position] },
    })),
  });
}

export function card(store, pickup, type = 4, media = {}, channel = pickup.channel_id) {
  const roster = store.roster(pickup.id);
  const room = ['playing', 'voting'].includes(pickup.status) ? store.room(pickup.id) : undefined;
  const roomReady = room?.channel_id && room.room_version === room.roster_version;
  const showMatchControls = !room || roomReady && room.channel_id === channel;
  const competitiveResult = pickup.status === 'closed' && !pickup.friendly;
  const victory = competitiveResult && TEAM_NAMES[pickup.outcome];
  const winners = competitiveResult ? store.mvps(pickup.id) : [];
  const [title, color, marker, artwork] = pickup.expired ? ['Caducada', 0x808995, '⌛', 'cola-cerrada']
    : victory ? [`${victory} gana`, pickup.outcome === 'A' ? 0x3d8bfd : 0xe54b63, '🏆', 'victoria']
    : competitiveResult ? ['Marcador final', 0xe8e8e8, '🏁', 'cierre'] : STAGES[pickup.status];
  const positionalSignup = pickup.status === 'open' && pickup.format === 'positional';
  const teamSignup = pickup.status === 'open' && pickup.format === TEAM_QUEUE_FORMAT;
  const draftSignup = pickup.status === 'open' && pickup.format === DRAFT_QUEUE_FORMAT;
  const draftQueue = draftSignup ? store.draftQueue(pickup.id) : [];
  const hasParty = positionalSignup && roster.some((p) => p.party_id);
  const teams = teamSignup ? Object.fromEntries(Object.keys(TEAM_NAMES).map((side) => [side, roster.filter((p) => p.team === side)])) : null;
  const positionSlots = positionalSignup ? Object.entries(POSITIONS).map(([position, limit]) => {
    const players = roster.filter((p) => p.position === position);
    return { position, limit, players, free: limit - players.length };
  }) : [];
  const fields = draftSignup ? [{ name: `👥 Inscritos · ${draftQueue.length}/${DRAFT_QUEUE_LIMIT}`,
    value: draftQueue.map((p) => `${mention(p.user_id)}${p.party_name ? ` ${PARTY_BADGES[p.party_badge]?.icon ?? '👥'}` : ''}`).join('\n') || 'La cola está abierta.' }]
    : teams || hasParty ? signupLineups(teams ?? provisionalTeams(roster)) : positionalSignup
    ? positionSlots.map(({ position, limit, players, free }) => {
      const lines = players.map((p) => `🟢 ${mention(p.user_id)}`);
      if (free) lines.push(`↳ ${freeSlots(free)}`);
      return {
        name: `${POSITION_MARKERS[position]} ${positionLabel(position)} · ${players.length}/${limit}${free ? '' : ' ✅'}`,
        value: lines.join('\n'),
      };
    })
    : Object.entries(TEAM_NAMES).map(([team, name]) => {
      const players = roster.filter((p) => p.team === team);
      return {
        name: `${TEAM_MARKERS[team]} Equipo ${name} · ${players.length}/${pickup.team_size}`,
        value: players.map((p, i) => {
          const position = p.position ? `${POSITION_MARKERS[p.position]} **${POSITION_NAMES[p.position]}** · ` : '';
          return `${i + 1}. ${position}${mention(p.user_id)}`;
        }).join('\n') || 'Sin jugadores',
      };
    });
  const info = [];
  const components = [];
  const kickControl = { ...button('Retirar jugador', 'kickmenu', pickup.id, 4, '🚫'), disabled: (draftSignup ? draftQueue : roster).length === 0 };
  const mode = pickup.friendly ? 'Amistosa' : 'Competitivo';
  for (const { side, name, badge } of lineupParties(roster).reverse()) {
    const field = fields.find((entry) => entry.name.startsWith(TEAM_MARKERS[side]));
    if (field) field.value = `${PARTY_BADGES[badge].icon} **${name}**\n${field.value}`;
  }
  if (pickup.friendly) info.push('🤝 **Amistosa** · Sin notas, MVP ni historial competitivo.');
  if (pickup.outcome) {
    const result = OUTCOMES[pickup.outcome];
    const marker = pickup.status === 'closed' && pickup.outcome !== 'draw' ? '🏆' : '🏟️';
    info.push(pickup.score_a !== null ? `${marker} **Azul ${pickup.score_a}–${pickup.score_b} Rojo**\n${result}` : `${marker} **${result}**`);
  }
  if (draftSignup) {
    info.push(`🕹️ **${mode} 5v5** · ${draftQueue.length < 10 ? `Faltan ${10 - draftQueue.length} para reunir diez.` : 'Ya hay diez o más inscritos.'}\nEl hoster de la pickup o un administrador elegirá quién juega y le asignará equipo y posición.`);
    components.push(row(button('Entrar a la cola', 'queuejoin', pickup.id, 1, '🎮'), button('Salir de la cola', 'leave', pickup.id, 2, '↩️'),
      button('Organizar equipos', 'draft', pickup.id, 2, '📋'), kickControl, button('Cancelar cola', 'cancel', pickup.id, 4, '🛑')));
  } else if (teamSignup || positionalSignup) {
    const capacity = pickup.team_size * 2;
    info.push(`⚽ **${mode} 5v5** · 👥 **${roster.length}/${capacity} inscritos**\n\`${'▰'.repeat(roster.length)}${'▱'.repeat(capacity - roster.length)}\``);
    if (hasParty) info.push('👥 Grupo reservado en su equipo. Al iniciar, el bot distribuye a quienes entraron por separado.');
    if (teams) {
      for (const [side, name] of Object.entries(TEAM_NAMES)) {
        const available = Object.entries(POSITIONS).map(([position, limit]) => ({
          position, free: limit / 2 - teams[side].filter((p) => p.position === position).length,
        })).filter(({ free }) => free > 0);
        if (available.length) components.push(positionMenu(pickup.id, `join${side}`, `${TEAM_MARKERS[side]} Elige tu posición en ${name}`, available));
      }
    } else {
      const available = positionSlots.filter(({ free }) => free > 0);
      if (available.length) components.push(positionMenu(pickup.id, 'position', '¿En qué posición vas a jugar?', available));
    }
    if (components.length) {
      info.push(teamSignup ? '👇 **Elige Azul o Rojo y ocupa un puesto libre.** Puedes cambiar de equipo o posición antes del inicio.'
        : '👇 **Elige tu posición para entrar.** Puedes cambiarla mientras haya cupo.');
    } else {
      info.push('✅ **Cupos completos.** La organización ya puede iniciar la partida.');
    }
    if (teamSignup && roster.some((p) => p.party_id)) info.push('👥 Integrantes de un grupo');
    components.push(row(button('Actualizar ficha', 'refresh', pickup.id, 2, '🔄'),
      button('Salir de la cola', 'leave', pickup.id, 2, '↩️'), button('Cancelar cola', 'cancel', pickup.id, 4, '🛑'), kickControl));
  } else if (pickup.status === 'open') {
    info.push(`⚽ **${mode} ${pickup.team_size}v${pickup.team_size}**\nElige un equipo para inscribirte.`);
    components.push(row(button('Unirme Azul', 'A', pickup.id, 1), button('Unirme Rojo', 'B', pickup.id, 1),
      button('Salir', 'leave', pickup.id), button('Cancelar cola', 'cancel', pickup.id, 4), kickControl));
  }
  if (pickup.expired) info.push(`La cola quedó incompleta tras ${QUEUE_IDLE_MINUTES} minutos de inactividad.`);
  if (pickup.status === 'canceled') fields.length = 0;
  if (pickup.status === 'playing') {
    info.push('⚔️ **Alineaciones confirmadas. ¡A jugar!**');
    if (showMatchControls) {
      const { count, required } = store.finishedProgress(pickup);
      components.push(row(button(`Confirmar fin (${count}/${required})`, 'finished', pickup.id, 3, '🏁'), kickControl));
      info.push(`🏁 Al terminar, pulsa **Confirmar fin**. Con **${required}** confirmaciones ${pickup.friendly ? 'se cierra la amistosa.' : 'se abre la votación del jugador más valioso.'}`);
    }
  }
  if (pickup.status === 'voting') {
    if (!pickup.outcome) info.push('📋 Marcador pendiente de la organización.');
    const count = store.voteCount(pickup.id);
    const open = store.now() < pickup.vote_until;
    const notes = roster.filter((p) => p.grade !== null).length;
    info.push([
      `🗳️ **Votos MVP:** ${count}/${roster.length} · ${open ? `hasta <t:${Math.ceil(pickup.vote_until / 1000)}:t>` : 'votación terminada'}`,
      `📝 **Notas capturadas:** ${notes}/${roster.length}`,
    ].join('\n'));
    const ready = pickup.outcome && notes === roster.length && (!open || count === roster.length);
    info.push(ready ? `✅ **Lista para cerrar.** La organización puede usar \`/pickup cerrar id:${pickup.id}\`.`
      : `📌 La organización publicará el resultado y el MVP con \`/pickup cerrar id:${pickup.id}\`.`);
    if (showMatchControls) {
      const actions = [button('Actualizar ficha', 'refresh', pickup.id, 2, '🔄')];
      if (open) actions.unshift(button('Votar MVP', 'mvp', pickup.id, 1, '🌟'));
      components.push(row(...actions));
    }
  }
  if (competitiveResult) {
    const mvpTitle = winners.length > 1 ? 'MVP compartido' : 'Jugador más valioso (MVP)';
    info.push(`🌟 **${mvpTitle}** · ${winners.length ? `${winners[0].votes} ${winners[0].votes === 1 ? 'voto' : 'votos'} por jugador` : 'sin votos'}`);
    const highlights = Object.keys(TEAM_NAMES).flatMap((side) => {
      const players = roster.filter((p) => p.team === side && winners.some(({ user_id }) => user_id === p.user_id));
      return players.length ? [{ name: `🌟 ${mvpTitle} · ${TEAM_NAMES[side]}`, value: players.map(({ user_id, position }) =>
        `${TEAM_MARKERS[side]} ${mention(user_id)}${position ? ` · ${positionLabel(position)}` : ''}`).join('\n') }] : [];
    });
    fields.unshift(...highlights);
    components.push(row(button('Ver mi tarjeta', 'arcade', 'view', 2, '🎮')));
  }
  if (roomReady && !showMatchControls) {
    info.push(`🔒 **Sala privada** · <#${room.channel_id}>\nComparte allí el enlace de Blue Lock Rivals.`);
    components.push(row({ type: 2, style: 5, label: 'Ir a la sala privada', emoji: { name: '🔒' },
      url: `https://discord.com/channels/${pickup.guild_id}/${room.channel_id}` }));
  } else if (room && !roomReady) {
    info.push('🔒 **Preparando la sala privada.** El acceso aparecerá en esta ficha.');
  }
  if (pickup.status === 'open' && channel !== pickup.channel_id) {
    components.length = 0;
    components.push(row(kickControl));
    info.push(`🔄 **Buscando reemplazo.** Los cupos disponibles están en <#${pickup.channel_id}>.`);
  }
  return {
    type,
    ...(channel === pickup.channel_id && (pickup.status === 'open' || room) ? { queueId: pickup.id } : {}),
    data: {
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `${marker} ${pickup.friendly ? 'Amistosa' : 'Partida'} #${pickup.id} · ${title}`,
        color,
        fields,
        footer: { text: `SA PICKUPS · ${mode.toUpperCase()}` },
        ...embedMedia(pickup.friendly ? media.amistosa ?? media[artwork] : media[artwork] ?? (victory ? media.cierre : undefined)),
        ...embedMedia(winners.length ? media.mvp : undefined, 'thumbnail'),
        ...(info.length ? { description: info.join('\n\n') } : {}),
      }],
      components,
    },
  };
}

function gradeForm(store, pickup) {
  const roster = store.reviewRoster(pickup);
  return {
    type: 9,
    data: {
      custom_id: `sap:grades:${pickup.id}`,
      title: `Notas de la partida #${pickup.id}`,
      components: ['A', 'B'].map((team) => {
        const players = roster.filter((p) => p.team === team);
        const names = players.map((p, i) => `${i + 1}. ${p.name}`).join(' · ');
        return {
          type: 18, label: `Equipo ${TEAM_NAMES[team]} · ${players.length} notas`,
          description: names.length <= 100 ? names : 'Usa el orden del equipo que aparece en /pickup ver.',
          component: {
            type: 4, custom_id: team, style: 2, required: true, max_length: 100,
            placeholder: 'Una nota por línea, en orden. De 0 a 10.',
            ...(players.every((p) => p.grade !== null) ? { value: players.map((p) => p.grade / 10).join('\n') } : {}),
          },
        };
      }),
    },
  };
}

function submitGrades(store, pickup, context, components) {
  const roster = store.reviewRoster(pickup);
  const inputs = Object.fromEntries(components.map(({ component }) => [component.custom_id, component.value]));
  const entries = ['A', 'B'].flatMap((team) => {
    const players = roster.filter((p) => p.team === team);
    const grades = (inputs[team] ?? '').trim().split(/\r?\n/);
    if (grades.length !== players.length) {
      throw new PickupError(`El equipo ${TEAM_NAMES[team]} requiere ${players.length} notas, una por línea.`);
    }
    return players.map((p, i) => ({ user: p.user_id, grade: gradeInTenths(grades[i]) }));
  });
  store.grade(pickup, context.user, entries);
  return privateReply(`📝 Guardé las ${entries.length} notas de la partida #${pickup.id}.`);
}

function avatarUrl(context, member) {
  const { avatar, discriminator } = member.user;
  const hash = member.avatar || avatar;
  if (!hash) {
    const index = Number(discriminator) > 0 ? Number(discriminator) % 5 : Number((BigInt(context.user) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  const path = member.avatar ? `guilds/${context.guild}/users/${context.user}/avatars` : `avatars/${context.user}`;
  const extension = hash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/${path}/${hash}.${extension}?size=256`;
}

function profileReward(key, stats) {
  const reward = Object.hasOwn(PROFILE_REWARDS, key) && PROFILE_REWARDS[key];
  return reward && (!reward.earned || reward.earned(stats)) ? reward : PROFILE_REWARDS.clasico;
}

function profile(store, context, member, media, mode = 'public') {
  const { total, matches, wins } = store.profile(context.guild, context.user);
  const stats = store.profileAchievements(context.guild, context.user);
  const style = store.profileStyle(context);
  const frame = profileReward(style.frame, stats);
  const title = profileReward(style.title, stats);
  const editing = mode === 'edit' || mode === 'update';
  const rewards = Object.entries(PROFILE_REWARDS);
  const unlocks = rewards.filter(([, reward]) => !reward.earned || reward.earned(stats));
  const position = POSITION_NAMES[style.position];
  const rank = rankFor(total, matches);
  const progress = rank
    ? `${'⭐'.repeat(rank)} · **${rank}/6**`
    : `**En clasificación · ${matches}/${MIN_MATCHES}**\n\`${'▰'.repeat(matches)}${'▱'.repeat(MIN_MATCHES - matches)}\``;
  const history = store.history(context.guild, context.user).map(({ id, grade, outcome, team }) => {
    const result = outcome === team ? '🏆 Victoria' : outcome === 'draw' ? '🤝 Empate' : outcome ? '⚔️ Derrota' : '🎮 Partida';
    return `${result} · #${id} · **${(grade / 10).toFixed(1)}/10**`;
  });
  return {
    type: mode === 'update' ? 7 : 4,
    data: {
      ...(mode === 'edit' || mode === 'private' ? { flags: 64 } : {}),
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `🎮 Tarjeta arcade · ${context.name}`,
        description: `${title.icon} **${title.title}**${position ? ` · ${POSITION_MARKERS[style.position]} ${positionLabel(style.position)}` : ''}`,
        color: frame.color,
        image: { url: avatarUrl(context, member) },
        ...embedMedia(media[frame.art] ?? media.perfil, 'thumbnail'),
        fields: [
          { name: '⭐ Rango de estrellas', value: progress },
          { name: '📊 Nota media', value: matches ? `**${(total / matches / 10).toFixed(2)}/10**` : '—', inline: true },
          { name: '🏆 Victorias', value: `**${wins}** · ${matches ? `${Math.round(wins / matches * 100)}%` : '—'}`, inline: true },
          { name: '🎮 Partidas cerradas', value: `**${matches}**`, inline: true },
          { name: '🌟 MVP', value: `**${stats.mvps}**`, inline: true },
          { name: '🔥 Mejor racha', value: `**${stats.streak}** ${stats.streak === 1 ? 'victoria seguida' : 'victorias seguidas'}`, inline: true },
          { name: '🏅 Logros', value: rewards.filter(([, reward]) => reward.goal).map(([, reward]) =>
            reward.earned(stats) ? `${reward.icon} **${reward.title}**` : `🔒 ${reward.goal}`).join('\n') },
          { name: '📒 Últimas notas', value: history.join('\n') || 'El historial se llenará al cerrar la primera partida.' },
        ],
        footer: { text: `SA PICKUPS · MARCO ${frame.frame.toUpperCase()}` },
      }],
      components: editing ? [
        profileSelect('position', 'Posición favorita', [['ninguna', 'Sin posición'], ...Object.entries(POSITION_NAMES)], style.position ?? 'ninguna'),
        profileSelect('frame', 'Marco arcade', unlocks.map(([key, reward]) => [key, reward.frame]), style.frame ?? 'clasico'),
        profileSelect('title', 'Título', unlocks.map(([key, reward]) => [key, reward.title]), style.title ?? 'clasico'),
        row(button('Publicar mi tarjeta', 'arcade', 'publish', 1, '📣')),
      ] : [row(button('Personalizar mi tarjeta', 'arcade', 'edit', 2, '🕹️'))],
    },
  };
}

function profileSelect(field, placeholder, choices, selected) {
  return row({ type: 3, custom_id: `sap:arcade:${field}`, placeholder,
    options: choices.map(([value, label]) => ({ label, value, default: value === selected })) });
}

function ranking(store, guild, artwork) {
  const leaders = store.ranking(guild, MIN_MATCHES);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = leaders.map(({ user_id, total, matches, wins }, index) =>
    `${medals[index] ?? `**${index + 1}.**`} ${mention(user_id)} · **${(total / matches / 10).toFixed(2)}/10**\n` +
    `${stars(total, matches)} · 🏆 ${wins} ${wins === 1 ? 'victoria' : 'victorias'} · 🎮 ${matches} jugadas`);
  const sections = [];
  if (lines.length) sections.push(`**🏅 Podio**\n${lines.slice(0, 3).join('\n\n')}`);
  if (lines.length > 3) sections.push(`**📈 Clasificados**\n${lines.slice(3).join('\n\n')}`);
  return {
    type: 4,
    data: {
      allowed_mentions: { parse: [] },
      embeds: [{
        title: '🏆 Clasificación competitiva · SA Pickups',
        color: 0xe9b949,
        ...embedMedia(artwork),
        description: sections.join('\n\n') || `📣 **El podio está por estrenarse.**\nCompleta ${MIN_MATCHES} partidas calificadas para aparecer aquí.`,
        footer: { text: '15 MEJORES · ORDENADO POR NOTA MEDIA' },
      }],
    },
  };
}

function mvpMenu(store, pickup, user, artwork) {
  const candidates = store.voteCandidates(pickup, user);
  return {
    type: 4, data: {
      flags: 64,
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `🌟 Elige al jugador más valioso · #${pickup.id}`,
        description: 'Elige a otra persona de la partida. Puedes cambiar tu voto mientras siga abierta la votación.',
        color: 0xe9b949,
        ...embedMedia(artwork),
      }],
      components: [row({
        type: 3, custom_id: `sap:vote:${pickup.id}`, placeholder: '¿Quién se ganó tu voto?',
        options: candidates.map((p) => ({
          label: p.name, value: p.user_id, emoji: { name: TEAM_MARKERS[p.team] },
          description: `Equipo ${TEAM_NAMES[p.team]}${p.position ? ` · ${POSITION_NAMES[p.position]}` : ''}`,
        })),
      })],
    },
  };
}

function deferredPartyReply(payload, discord, work) {
  return {
    type: 5, data: { flags: 64 },
    async afterResponse() {
      let message;
      try {
        message = await work();
      } catch (error) {
        if (!(error instanceof PickupError)) throw error;
        message = error.message;
      }
      await discord.editReply(payload, message);
    },
  };
}

function partyCommand(payload, store, config, context, command, args) {
  const { discord } = config;
  if (command === 'crear') {
    store.createParty(context, args.posicion);
    return privateReply(`👥 Grupo creado. Juegas como **${positionLabel(args.posicion)}**. Usa \`/grupo invitar\` o \`/pickup buscar\`.`);
  }
  if (command === 'aceptar' || command === 'rechazar') {
    store.answerPartyInvite(context, null, command === 'aceptar' ? args.posicion : undefined);
    return privateReply(command === 'aceptar' ? `✅ Entraste al grupo como **${positionLabel(args.posicion)}**.` : 'Invitación rechazada.');
  }
  const party = store.partyFor(context);
  if (!party) throw new PickupError('Primero crea un grupo o acepta una invitación.');
  switch (command) {
    case 'identidad': {
      const name = args.nombre?.normalize('NFC').trim().replace(/ +/g, ' ');
      if (!name || !/^[\p{L}\p{M}\p{N} -]{2,18}$/u.test(name) || !/[\p{L}\p{N}]/u.test(name)) {
        throw new PickupError('Escribe entre 2 y 18 caracteres. Puedes usar letras, números, espacios y guiones.');
      }
      if (!Object.hasOwn(PARTY_BADGES, args.escudo)) throw new PickupError('Elige un escudo de la lista.');
      const updated = store.setPartyIdentity(context, name, args.escudo);
      return privateReply(`✅ Tu grupo ahora es ${PARTY_BADGES[updated.badge].icon} **${updated.name}**.`);
    }
    case 'ver': {
      const members = store.partyMembers(party.id);
      return { type: 4, data: { flags: 64, allowed_mentions: { parse: [] }, embeds: [{
        title: `${PARTY_BADGES[party.badge]?.icon ?? '👥'} ${party.name ?? 'Tu grupo'} · ${members.length}/5`, color: 0x3d8bfd,
        ...embedMedia(config.media?.grupo),
        description: members.map((p) => `${p.user_id === party.leader_id ? '👑' : '•'} ${mention(p.user_id)} · ` +
          `${POSITION_MARKERS[p.position]} **${positionLabel(p.position)}**`).join('\n'),
        footer: { text: 'El líder elige lado con /pickup buscar' },
      }] } };
    }
    case 'posicion':
      store.changePartyPosition(context, party, args.posicion);
      return privateReply(`✅ Posición cambiada a **${positionLabel(args.posicion)}**.`);
    case 'salir':
      store.leaveParty(context, party);
      return privateReply(party.leader_id === context.user ? 'Disolviste el grupo.' : 'Saliste del grupo.');
    case 'invitar': {
      const target = payload.data.resolved?.users?.[args.jugador];
      const member = payload.data.resolved?.members?.[args.jugador];
      if (!target || !member || target.bot || target.id === context.user) throw new PickupError('Invita a otro jugador de este servidor.');
      if (config.playerRole && !member.roles?.includes(config.playerRole) && !member.roles?.includes(config.staffRole)
        && !(BigInt(member.permissions ?? '0') & STAFF_PERMISSIONS)) {
        throw new PickupError('Ese jugador necesita el rol de jugador de SA Pickups.');
      }
      const invite = store.inviteToParty(context, party, target.id);
      const fallback = `${mention(target.id)} puede usar \`/grupo aceptar\` en el servidor.`;
      if (!discord) return privateReply(`Invitación guardada. ${fallback}`);
      return deferredPartyReply(payload, discord, async () => {
        try {
          await discord.sendInvite(target.id, invite.id, {
            content: `🎉 ${mention(context.user)} te invitó a su grupo de **SA Pickups**. Vence <t:${Math.floor(invite.expires_at / 1000)}:R>.`,
            allowed_mentions: { parse: [] },
            components: [row(button('Aceptar', 'partyaccept', invite.id, 3, '✅'), button('Rechazar', 'partydecline', invite.id, 4, '✖️'))],
          });
          return `✉️ Invitación enviada a ${mention(target.id)}.`;
        } catch {
          return `Discord no pudo entregar el mensaje privado. ${fallback}`;
        }
      });
    }
    default: throw new PickupError('Usa un subcomando de /grupo.');
  }
}

function partyDirectMessage(payload, store, config, match) {
  const user = payload.user;
  if (!user || payload.guild_id) throw new PickupError('Usa este botón en el mensaje privado de invitación.');
  const [, action, id] = match;
  const context = { guild: config.guildId, user: user.id, name: user.global_name || user.username };
  const invite = store.partyInvite(context, Number(id));
  if (action === 'partydecline') {
    store.answerPartyInvite(context, invite.id);
    return { type: 7, data: { content: 'Invitación rechazada.', components: [] } };
  }
  if (action === 'partyaccept') {
    const positions = store.availablePartyPositions(invite.party_id);
    if (!positions.length) throw new PickupError('El grupo ya está completo.');
    return { type: 7, data: {
      content: '👥 Elige tu posición para entrar al grupo.',
      components: [row({
        type: 3, custom_id: `sap:partyposition:${invite.id}`, placeholder: 'Elige tu posición',
        options: positions.map((position) => ({ label: positionLabel(position), value: position, emoji: { name: POSITION_MARKERS[position] } })),
      }), row(button('Rechazar', 'partydecline', invite.id, 4))],
    } };
  }
  if (!config.discord) throw new PickupError('Completa la invitación con /grupo aceptar en el servidor.');
  return deferredPartyReply(payload, config.discord, async () => {
    const member = await config.discord.member(context.guild, context.user).catch(() => null);
    if (!member || (config.playerRole && !member.roles?.includes(config.playerRole) && !member.roles?.includes(config.staffRole))) {
      throw new PickupError('Completa la invitación con /grupo aceptar en el servidor para verificar tu acceso.');
    }
    const position = payload.data.values?.[0];
    if (!position) throw new PickupError('Selecciona una posición.');
    store.answerPartyInvite({ ...context, name: member.nick || context.name }, invite.id, position);
    return `✅ Entraste al grupo como **${positionLabel(position)}**. Tu líder puede buscar con \`/pickup buscar\`.`;
  });
}

async function withPickupCreation(config, memberRoles, create) {
  const roles = await config.discord?.roles?.(config.guildId).catch(() => null);
  if (!roles) return privateReply('No pude consultar los roles de Discord. Vuelve a intentar en unos segundos.');
  const threshold = config.hosterRole.toLowerCase();
  const byId = /^\d{17,20}$/.test(threshold);
  const hoster = roles.filter((role) => role.id !== config.guildId &&
    (byId ? role.id === threshold : role.name.toLowerCase() === threshold));
  if (hoster.length !== 1) return privateReply('La organización necesita configurar el rol Hoster para abrir convocatorias.');
  const [baseRole] = hoster;
  // Discord desempata posiciones compartidas dando prioridad al ID menor.
  const allowed = roles.some((role) => memberRoles.includes(role.id) && role.id !== config.guildId &&
    (role.id === baseRole.id || role.position > baseRole.position ||
      (role.position === baseRole.position && BigInt(role.id) < BigInt(baseRole.id))));
  if (!allowed) return privateReply('Necesitas el rol Hoster o uno superior para abrir una convocatoria.');
  try {
    return create();
  } catch (error) {
    if (error instanceof PickupError) return privateReply(error.message);
    throw error;
  }
}

function withPickupModeration(store, config, context, pickup, override, message, denied, action) {
  const moderate = (current) => {
    if (!override && current.created_by !== context.user) {
      return privateReply(denied);
    }
    try {
      return action(current);
    } catch (error) {
      if (error instanceof PickupError) return privateReply(error.message);
      throw error;
    }
  };
  if (pickup.created_by || override) return moderate(pickup);

  // Older pickups lack created_by. Only the bot's reply to the original command proves ownership.
  const originalAuthor = (candidate) => candidate?.author?.id === config.appId &&
    candidate.interaction_metadata?.id === pickup.request_id && candidate.interaction_metadata.type === 2
    ? candidate.interaction_metadata.user?.id : undefined;
  const resolveCreator = (user) => {
    if (!user) return moderate(pickup);
    store.rememberCreator(pickup.id, user);
    return moderate(store.pickup(context, pickup.id));
  };
  const user = originalAuthor(message);
  if (user) return resolveCreator(user);
  if (!config.discord?.messagesAround || !/^\d{17,20}$/.test(pickup.request_id)) return moderate(pickup);
  return config.discord.messagesAround(pickup.channel_id, pickup.request_id).catch(() => []).then((messages) =>
    resolveCreator(messages.map(originalAuthor).find(Boolean)));
}

function kickMenu(store, pickup) {
  if (!['open','playing'].includes(pickup.status)) {
    throw new PickupError('Solo puedes retirar jugadores antes de que empiece la evaluación.');
  }
  const drafted = pickup.format === DRAFT_QUEUE_FORMAT && pickup.status === 'open';
  const players = drafted ? store.draftQueue(pickup.id) : store.roster(pickup.id);
  if (!players.length) throw new PickupError('Esta pickup todavía no tiene jugadores inscritos.');
  const options = players.map((player) => {
    const assigned = drafted ? DRAFT_SLOTS.find(({ key }) => key === player.slot) : player;
    const position = assigned?.position ? positionLabel(assigned.position) : '';
    const awaitingTeam = pickup.status === 'open' && pickup.format === 'positional' && !player.party_id;
    const team = awaitingTeam ? '' : TEAM_NAMES[assigned?.team];
    return {
      label: player.name.trim().slice(0, 90) || 'Jugador',
      value: player.user_id,
      description: [team, position].filter(Boolean).join(' · ') || (drafted ? 'En cola' : ''),
    };
  });
  return privateReply(`Elige a quién retirar de la pickup #${pickup.id}. Al seleccionarlo, su cupo quedará libre y ese jugador no podrá volver a entrar a esta pickup.`,
    [row({ type: 3, custom_id: `sap:kickselect:${pickup.id}`, placeholder: 'Selecciona un jugador', options })]);
}

function draftEditor(store, pickup, media, slot, type = 4) {
  if (pickup.status !== 'open') throw new PickupError('La cola ya no está abierta.');
  const entries = store.draftQueue(pickup.id);
  const assigned = new Map(entries.filter((p) => p.slot).map((p) => [p.slot, p]));
  const label = ({ key, position }) => `${POSITION_NAMES[position]}${position === 'Winger' ? ` ${key.endsWith('2') ? '1' : '2'}` : ''}`;
  const fields = Object.entries(TEAM_NAMES).map(([team, name]) => ({
    name: `${TEAM_MARKERS[team]} ${name}`,
    value: DRAFT_SLOTS.filter((position) => position.team === team).map((position) => {
      const player = assigned.get(position.key);
      return `${POSITION_MARKERS[position.position]} **${label(position)}** · ${player ? mention(player.user_id) : 'Libre'}`;
    }).join('\n'),
    inline: true,
  }));
  const menus = [row({ type: 3, custom_id: `sap:draftslot:${pickup.id}`, placeholder: '1. Elige equipo y posición',
    options: DRAFT_SLOTS.map((position) => ({ value: position.key, label: `${TEAM_NAMES[position.team]} · ${label(position)}`,
      emoji: { name: TEAM_MARKERS[position.team] }, default: position.key === slot, description: assigned.has(position.key) ? 'Asignado' : 'Libre' })) })];
  if (slot) {
    const options = entries.filter((p) => !p.slot).map((p) => ({ value: p.user_id,
      label: p.name.trim().slice(0, 90) || 'Jugador', description: p.party_name ?? `ID · ${p.user_id}` }));
    if (assigned.has(slot)) options.unshift({ value: 'libre', label: 'Liberar el puesto' });
    if (options.length) menus.push(row({ type: 3, custom_id: `sap:draftpick:${pickup.id}:${slot}`,
      placeholder: '2. Elige a un jugador de la cola', options }));
  }
  return { type, data: { ...(type === 4 ? { flags: 64 } : {}), allowed_mentions: { parse: [] }, embeds: [{
    title: `🕹️ Organizar equipos · Pickup #${pickup.id}`, color: 0xe8e8e8,
    description: `**${assigned.size}/10 puestos asignados** · **${entries.length} inscritos**\nElige un puesto y después un jugador. Para mover a un jugador, primero libera su puesto anterior.`,
    fields, ...embedMedia(pickup.friendly ? media.amistosa : media.convocatoria, 'thumbnail'),
    footer: { text: 'SA PICKUPS · ALINEACIÓN 5V5' },
  }], components: [...menus, row(button('Actualizar inscritos', 'draftreload', pickup.id, 2, '🔄'),
    { ...button('Iniciar pickup', 'draftstart', pickup.id, 3, '🏁'), disabled: assigned.size !== DRAFT_SLOTS.length })] } };
}

function requirePrivateRoom(store, pickup, channel) {
  const room = store.room(pickup.id);
  if (room && room.room_version !== room.roster_version) throw new PickupError('La sala privada se está actualizando.');
  if (room && room.channel_id !== channel) {
    throw new PickupError(room.channel_id ? `Usa los controles de la partida en <#${room.channel_id}>.`
      : 'La sala privada todavía se está preparando.');
  }
}

export function handleInteraction(payload, store, config) {
  if (payload.type === 1) return { type: 1 };
  try {
    const { member, data } = payload;
    if (payload.application_id !== config.appId) throw new PickupError('Aplicación no autorizada.');
    if (payload.type === 2 && data?.name === 'help' && payload.guild_id === config.guildId && member?.user) {
      return help(config.media?.ayuda, config.roomCategory);
    }
    store.expireQueues();
    const dm = /^sap:(partyaccept|partydecline|partyposition):([1-9][0-9]*)$/.exec(data?.custom_id ?? '');
    if (payload.type === 3 && dm) return partyDirectMessage(payload, store, config, dm);
    if (payload.guild_id !== config.guildId || !member?.user) {
      throw new PickupError('Este bot es exclusivo del servidor SA Pickups.');
    }
    const channel = payload.channel?.id ?? payload.channel_id;
    const arcade = payload.type === 3 && /^sap:arcade:(view|edit|publish|position|frame|title)$/.exec(data?.custom_id ?? '')?.[1];
    const standalone = arcade || payload.type === 2 && ['perfil', 'clasificacion'].includes(data?.name);
    const inRoom = !standalone && store.isRoom(config.guildId, channel ?? '');
    if (!standalone && !inRoom && config.channels.length && !config.channels.includes(channel)) {
      throw new PickupError('Usa un canal autorizado de SA Pickups.');
    }
    const roles = member.roles ?? [];
    const staff = Boolean((BigInt(member.permissions ?? '0') & STAFF_PERMISSIONS) || roles.includes(config.staffRole));
    const admin = Boolean(BigInt(member.permissions ?? '0') & (1n << 3n));
    const cancelOverride = config.cancelRoles?.some((id) => roles.includes(id));
    const context = {
      guild: config.guildId, channel, user: member.user.id,
      name: member.nick || member.user.global_name || member.user.username,
    };
    const media = config.media ?? {};
    const renderPickup = (pickup, type = 4) => card(store, pickup, type, media, channel);
    const organize = (pickup, action) => withPickupModeration(store, config, context, pickup, admin, payload.message,
      'Solo el hoster que abrió la pickup o un administrador puede organizar los equipos.', action);
    const cancelButton = payload.type === 3 && /^sap:cancel:([1-9][0-9]*)$/.exec(data?.custom_id ?? '');
    const cancelSlash = payload.type === 2 && data?.name === 'pickup' && data.options?.[0]?.name === 'cancelar';
    if (cancelButton || cancelSlash) {
      const id = cancelButton ? Number(cancelButton[1]) : data.options[0].options?.find((option) => option.name === 'id')?.value;
      return withPickupModeration(store, config, context, store.pickup(context, id), cancelOverride, payload.message,
        'Solo quien abrió esta pickup o los roles de dirección autorizados pueden cancelarla.', (current) => {
          if (current.status === 'closed') return privateReply('Esa pickup ya está cerrada.');
          if (cancelButton && !['open','canceled'].includes(current.status)) return privateReply('Esa cola ya no está abierta.');
          return renderPickup(store.cancel(current), cancelButton ? 7 : 4);
        });
    }
    const kickSlash = payload.type === 2 && data?.name === 'pickup' && data.options?.[0]?.name === 'kick';
    const kickComponent = payload.type === 3 && /^sap:(kickmenu|kickselect):([1-9][0-9]{0,14})$/.exec(data?.custom_id ?? '');
    if (kickSlash || kickComponent) {
      const args = kickSlash ? Object.fromEntries((data.options[0].options ?? []).map(({ name, value }) => [name, value]))
        : { id: Number(kickComponent[2]), jugador: data.values?.[0] };
      return withPickupModeration(store, config, context, store.pickup(context, args.id), cancelOverride, payload.message,
        'Solo quien abrió esta pickup o los roles de dirección autorizados pueden retirar jugadores.', (current) => {
          if (kickComponent?.[1] === 'kickmenu') return kickMenu(store, current);
          if (!/^\d{17,20}$/.test(args.jugador ?? '')) throw new PickupError('Elige a un jugador de la pickup.');
          store.kick(context, current.id, args.jugador);
          const content = `✅ <@${args.jugador}> salió de la pickup #${current.id} y quedó vetado para esa partida. Cupo libre en <#${current.channel_id}>.`;
          return kickComponent ? { type: 7, data: { content, components: [], allowed_mentions: { parse: [] } } }
            : privateReply(content);
        });
    }
    if (!staff && config.playerRole && !roles.includes(config.playerRole)) {
      throw new PickupError('Necesitas el rol de jugador de SA Pickups.');
    }
    const lineup = /^sap:lineup:([1-9][0-9]{0,14})$/.exec(data?.custom_id ?? '');
    if (lineup && config.lineupViewer && (payload.type === 3 || payload.type === 5)) {
      const id = Number(lineup[1]);
      if (payload.type === 5) {
        const code = data.components?.find((item) => item.component?.custom_id === 'code')?.component.value;
        if (!/^[a-f0-9]{8}$/i.test(code?.trim() ?? '')) throw new PickupError('Escribe el código de ocho caracteres del visor.');
        config.lineupViewer.authorize(id, channel, context.user, code);
        return privateReply('✅ Visor autorizado. Vuelve a la pestaña del visor para ver la alineación.');
      }
      config.lineupViewer.authorize(id, channel, context.user);
      return { type: 9, data: {
        title: 'Autorizar visor 3D', custom_id: data.custom_id, components: [{
          type: 18, label: 'Código que aparece en el visor',
          component: { type: 4, custom_id: 'code', style: 1, required: true, min_length: 8, max_length: 8 },
        }],
      } };
    }
    if (arcade) {
      if (arcade === 'view') return profile(store, context, member, media, 'private');
      if (arcade === 'edit') return profile(store, context, member, media, 'edit');
      if (arcade === 'publish') return profile(store, context, member, media);
      const value = data.values?.[0];
      if (arcade === 'position') {
        if (value !== 'ninguna' && !Object.hasOwn(POSITIONS, value)) throw new PickupError('Elige una posición de la lista.');
      } else {
        const reward = Object.hasOwn(PROFILE_REWARDS, value) && PROFILE_REWARDS[value];
        if (!reward || (reward.earned && !reward.earned(store.profileAchievements(context.guild, context.user)))) {
          throw new PickupError('Ese estilo todavía no está desbloqueado.');
        }
      }
      store.setProfileStyle(context, { [arcade]: value === 'ninguna' ? null : value });
      return profile(store, context, member, media, 'update');
    }
    if (standalone) return data.name === 'perfil'
      ? profile(store, context, member, media)
      : ranking(store, context.guild, media.clasificacion);
    if (payload.type === 2 && ['pickup', 'grupo', 'party'].includes(data.name)) {
      const [command] = data.options;
      const args = Object.fromEntries((command.options ?? []).map((o) => [o.name, o.value]));
      if (inRoom && (data.name !== 'pickup' || ['crear', 'buscar'].includes(command.name))) {
        throw new PickupError('Para organizar un grupo o abrir otra pickup, usa un canal de convocatorias.');
      }
      if (data.name !== 'pickup') return partyCommand(payload, store, config, context, command.name, args);
      if (command.name === 'buscar') {
        const queue = (canCreate) => renderPickup(store.queueParty(context, payload.id, args.equipo, canCreate,
          Boolean(config.roomCategory), DRAFT_QUEUE_FORMAT));
        try {
          return queue(!config.hosterRole);
        } catch (error) {
          if (!(error instanceof PickupCreationRequired)) throw error;
          return withPickupCreation(config, roles, () => queue(true));
        }
      }
      if (command.name === 'crear') {
        const create = () => renderPickup(store.create(context, DEFAULT_TEAM_SIZE, payload.id, DRAFT_QUEUE_FORMAT, args.modo === 'amistosa'));
        if (config.hosterRole) return withPickupCreation(config, roles, create);
        if (!staff) throw new PickupError('Este comando es para la organización.');
        return create();
      }
      if (command.name === 'perfil') return profile(store, context, member, media, 'private');
      if (command.name === 'ranking') return ranking(store, context.guild, media.clasificacion);
      const pickup = store.pickup(context, args.id);
      if (command.name === 'iniciar' && pickup.format === DRAFT_QUEUE_FORMAT) {
        return organize(pickup, (current) => draftEditor(store, current, media));
      }
      const managesFriendly = pickup.friendly && ['iniciar', 'cerrar'].includes(command.name) &&
        (pickup.created_by === context.user || cancelOverride);
      if (STAFF.has(command.name) && !staff && !managesFriendly) throw new PickupError('Este comando es para la organización.');
      switch (command.name) {
        case 'ver': return renderPickup(pickup);
        case 'iniciar': return renderPickup(store.start(pickup));
        case 'confirmar': {
          requirePrivateRoom(store, pickup, channel);
          const updated = store.voteFinished(pickup, context.user);
          if (updated.status !== 'playing') return renderPickup(updated);
          const { count, required } = store.finishedProgress(updated);
          return privateReply(`✅ Fin confirmado. Van **${count}/${required}** confirmaciones.`);
        }
        case 'votar':
          requirePrivateRoom(store, pickup, channel);
          return mvpMenu(store, pickup, context.user, media.mvp);
        case 'terminar':
        case 'finalizar': return renderPickup(store.finish(pickup, context.user, { outcome: args.resultado, minutes: args.minutos, score: args.marcador }));
        case 'cerrar':
          if (pickup.status === 'open') throw new PickupError('La cola aún está abierta. Usa /pickup cancelar o el botón Cancelar cola.');
          return renderPickup(store.close(pickup));
        case 'calificar':
          if (args.jugador === undefined && args.nota === undefined) return gradeForm(store, pickup);
          if (args.jugador === undefined || args.nota === undefined) throw new PickupError('Indica tanto el jugador como su nota.');
          store.grade(pickup, context.user, [{ user: args.jugador, grade: gradeInTenths(args.nota) }]);
          return privateReply(`📝 Guardé la nota para ${mention(args.jugador)} en la partida #${pickup.id}.`);
      }
    }

    const draft = payload.type === 3 && /^sap:(draft|draftreload|draftslot|draftpick|draftstart):([1-9][0-9]{0,14})(?::([AB][0-4]))?$/.exec(data?.custom_id ?? '');
    if (draft) {
      const [, action, id, requestedSlot] = draft;
      const pickup = store.pickup(context, Number(id));
      if (pickup.format !== DRAFT_QUEUE_FORMAT) throw new PickupError('Esta pickup usa la ficha de la convocatoria original.');
      return organize(pickup, (current) => {
        if (action === 'draft') return draftEditor(store, current, media);
        if (action === 'draftstart') {
          store.startDraft(context, current.id, Boolean(config.roomCategory));
          return { type: 7, data: { content: '✅ Pickup iniciada. La alineación se mostrará en la ficha pública.', embeds: [], components: [] } };
        }
        const value = data.values?.[0];
        if (action === 'draftreload') return draftEditor(store, current, media, undefined, 7);
        const slot = action === 'draftslot' ? value : requestedSlot;
        if (!DRAFT_SLOTS.some(({ key }) => key === slot)) throw new PickupError('Elige un puesto de la lista.');
        if (action === 'draftpick') {
          if (value !== 'libre' && !/^\d{17,20}$/.test(value ?? '')) throw new PickupError('Elige un jugador de la cola.');
          store.assignDraftSlot(context, current.id, slot, value === 'libre' ? null : value);
        }
        return draftEditor(store, current, media, slot, 7);
      });
    }
    const match = /^sap:(A|B|joinA|joinB|queuejoin|leave|position|finished|mvp|vote|grades|refresh):([1-9][0-9]*)$/.exec(data?.custom_id ?? '');
    if (match && (payload.type === 3 || payload.type === 5)) {
      const [, action, id] = match;
      const pickup = store.pickup(context, Number(id));
      if (payload.type === 3 && pickup.status === 'canceled') return renderPickup(pickup, 7);
      if (payload.type === 3 && ['finished', 'mvp', 'vote'].includes(action)) requirePrivateRoom(store, pickup, channel);
      if (payload.type === 5 && action === 'grades') {
        if (!staff) throw new PickupError('Solo la organización puede calificar.');
        return submitGrades(store, pickup, context, data.components);
      }
      if (payload.type === 3 && ['A', 'B', 'joinA', 'joinB', 'leave', 'position'].includes(action)) {
        if (channel !== pickup.channel_id) throw new PickupError(`Gestiona tu cupo en <#${pickup.channel_id}>.`);
        if (pickup.format === DRAFT_QUEUE_FORMAT) {
          if (action !== 'leave') throw new PickupError('Pulsa Entrar a la cola en la ficha actual.');
          return renderPickup(store.joinDraft(context, pickup.id, false), 7);
        }
        const team = action.startsWith('join') ? action.at(-1) : undefined;
        const choice = team || action === 'position' ? data.values?.[0] : action === 'leave' ? null : action;
        if (choice === undefined) throw new PickupError('Elige una posición de la lista.');
        const updated = store.transaction(() => {
          const current = store.pickup(context, pickup.id);
          store.enroll(context, current, choice, team);
          return config.roomCategory ? store.startFilledRoom(current) : current;
        });
        return renderPickup(updated, 7);
      }
      if (payload.type === 3 && action === 'queuejoin') {
        if (channel !== pickup.channel_id) throw new PickupError(`Gestiona tu cupo en <#${pickup.channel_id}>.`);
        return renderPickup(store.joinDraft(context, pickup.id, true), 7);
      }
      if (payload.type === 3 && action === 'finished') {
        return renderPickup(store.voteFinished(pickup, context.user), 7);
      }
      if (payload.type === 3 && action === 'refresh') return renderPickup(pickup, 7);
      if (payload.type === 3 && action === 'mvp') return mvpMenu(store, pickup, context.user, media.mvp);
      if (payload.type === 3 && action === 'vote') {
        store.vote(pickup, context.user, data.values[0]);
        return privateReply(`✅ **Voto registrado** para ${mention(data.values[0])}. El resultado se publicará al cerrar la partida.`);
      }
    }
    return privateReply('Usa los comandos de /pickup o los botones de la ficha actual.');
  } catch (error) {
    if (error instanceof PickupError) return privateReply(error.message);
    throw error;
  }
}
