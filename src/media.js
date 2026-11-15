export const ARCADE_PATHS = { celebracion: '/assets/celebracion.gif', ...Object.fromEntries([
  'convocatoria', 'en-juego', 'mvp', 'cierre', 'clasificacion', 'grupo', 'cola-cerrada', 'perfil', 'ayuda', 'amistosa', 'victoria',
].map((name) => [name, '/assets/arcade/' + name + '.gif'])) };

export function arcadeUrls(base) {
  if (!base) return {};
  const origin = new URL(base);
  if (origin.protocol !== 'https:') throw new Error('PUBLIC_BASE_URL debe usar HTTPS.');
  return Object.fromEntries(Object.entries(ARCADE_PATHS).map(([name, path]) => [name, new URL(path, origin).href]));
}
