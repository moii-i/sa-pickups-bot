export const PARTY_BADGES = {
  escudo: { name: 'Escudo clásico', icon: '🛡️', pixels: '01110/11111/11111/01110/00100' },
  llama: { name: 'Gol en llamas', icon: '🔥', pixels: '00100/00110/01110/11111/01110' },
  rayo: { name: 'Rayo arcade', icon: '⚡', pixels: '00110/01100/11110/00100/01000' },
  estrella: { name: 'Estrella', icon: '⭐', pixels: '00100/10101/01110/11111/01010' },
};

export const PROFILE_REWARDS = {
  clasico: { title: 'Jugador de arcade', frame: 'Arcade clásico', icon: '🎮', color: 0xe8e8e8, art: 'perfil' },
  mvp: { title: 'Jugador estelar', frame: 'Estrella MVP', icon: '🌟', color: 0xe9b949, art: 'mvp',
    goal: 'Gana tu primer MVP', earned: ({ mvps }) => mvps >= 1 },
  victorias: { title: 'Cinco victorias', frame: 'Gol en llamas', icon: '🔥', color: 0xf0ad45, art: 'victoria',
    goal: 'Consigue 5 victorias', earned: ({ wins }) => wins >= 5 },
  racha: { title: 'En racha', frame: 'Racha arcade', icon: '⚡', color: 0x825ee4, art: 'clasificacion',
    goal: 'Gana 3 competitivas seguidas', earned: ({ streak }) => streak >= 3 },
};
