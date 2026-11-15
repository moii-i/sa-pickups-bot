import { POSITIONS, PickupError } from './rules.js';

export function balancedTeams(roster) {
  const groups = Object.entries(POSITIONS).map(([position, slots]) => {
    const players = roster.filter((player) => player.position === position);
    if (players.length !== slots) throw new PickupError(`Completa los ${slots} cupos de ${position} antes de iniciar.`);
    return players;
  });

  const total = roster.reduce((sum, player) => sum + player.rating, 0);
  let best;
  let closest = Infinity;
  function assign(index, blue, rating) {
    if (index === groups.length) {
      const difference = Math.abs(2 * rating - total);
      if (difference < closest) {
        closest = difference;
        best = blue;
      }
      return;
    }
    const group = groups[index];
    for (let mask = 1; mask < (1 << group.length) - 1; mask++) {
      const selection = group.filter((_, i) => mask & (1 << i));
      if (selection.length * 2 !== group.length) continue;
      if (group.some((player) => player.party_id && selection.includes(player) !== (player.team === 'A'))) continue;
      assign(index + 1, [...blue, ...selection.map((p) => p.user_id)],
        rating + selection.reduce((sum, p) => sum + p.rating, 0));
    }
  }

  assign(0, [], 0);
  return new Set(best);
}
