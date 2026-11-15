export const MIN_MATCHES = 3;
export const DEFAULT_TEAM_SIZE = 5;
export const DEFAULT_VOTE_MINUTES = 15;
export const QUEUE_IDLE_MINUTES = 15;
export const ROOM_RETENTION_HOURS = 24;
export const TEAM_QUEUE_FORMAT = 'team_positions';
export const DRAFT_QUEUE_FORMAT = 'host_draft';
export const DRAFT_QUEUE_LIMIT = 25;
export const DRAFT_SLOTS = ['A', 'B'].flatMap((team) =>
  ['GK', 'CM', 'Winger', 'Winger', 'CF'].map((position, index) => ({ key: `${team}${index}`, team, position })));

export const OUTCOMES = {
  A: 'Victoria del equipo Azul',
  B: 'Victoria del equipo Rojo',
  draw: 'Empate',
};

export const POSITIONS = { Winger: 4, GK: 2, CM: 2, CF: 2 };
export const TEAM_NAMES = { A: 'Azul', B: 'Rojo' };
export const POSITION_MARKERS = { Winger: '⚡', GK: '🧤', CM: '🛡️', CF: '🎯' };
export const POSITION_NAMES = { Winger: 'Extremo', GK: 'Portero', CM: 'Mediocampista', CF: 'Delantero' };

const STAR_THRESHOLDS = [0, 50, 60, 70, 80, 90];

export function rankFor(total, matches) {
  if (matches < MIN_MATCHES) return 0;
  return STAR_THRESHOLDS.filter((minimum) => total >= minimum * matches).length;
}

export function gradeInTenths(value) {
  const text = String(value).trim();
  if (!/^(?:[0-9](?:[.,][0-9])?|10(?:[.,]0)?)$/.test(text)) {
    throw new PickupError('Escribe una nota del 0 al 10 con un decimal como máximo.');
  }
  return Math.round(Number(text.replace(',', '.')) * 10);
}

export class PickupError extends Error {}
export class PickupCreationRequired extends PickupError {}
