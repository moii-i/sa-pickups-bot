import { DEFAULT_VOTE_MINUTES, OUTCOMES, POSITION_NAMES } from './rules.js';
import { PARTY_BADGES } from './arcade.js';

const id = {
  type: 4, name: 'id', description: 'Número de pickup, sin el #.', required: true, min_value: 1,
};
const sub = (name, description, options = []) => ({ type: 1, name, description, options });
const position = { type: 3, name: 'posicion', description: 'Posición para jugar con tu grupo.', required: true,
  choices: Object.entries(POSITION_NAMES).map(([value, name]) => ({ name: `${name} (${value})`, value })) };

export const partyCommand = {
  type: 1, name: 'grupo', description: 'Organiza un equipo para buscar partidas juntos',
  options: [
    sub('crear', 'Crea un grupo y elige tu posición.', [position]),
    sub('invitar', 'Envía por mensaje privado una invitación a tu grupo.', [
      { type: 6, name: 'jugador', description: 'Jugador del servidor al que quieres invitar.', required: true },
    ]),
    sub('aceptar', 'Acepta tu última invitación vigente y elige posición.', [position]),
    sub('rechazar', 'Rechaza tu última invitación vigente.'),
    sub('posicion', 'Cambia tu posición antes de entrar a una cola.', [position]),
    sub('identidad', 'Líder · Elige el nombre y escudo del grupo para la próxima pickup.', [
      { type: 3, name: 'nombre', description: 'Nombre de tu grupo, hasta 18 caracteres.', required: true, min_length: 2, max_length: 18 },
      { type: 3, name: 'escudo', description: 'Símbolo que aparecerá en la alineación.', required: true,
        choices: Object.entries(PARTY_BADGES).map(([value, { name, icon }]) => ({ name: `${icon} ${name}`, value })) },
    ]),
    sub('ver', 'Muestra tu grupo y sus posiciones en privado.'),
    sub('salir', 'Abandona el grupo. Si eres el líder, disuelve el equipo.'),
  ],
};

export const pickupCommand = {
  type: 1,
  name: 'pickup',
  description: 'Partidas competitivas y amistosas de SA Pickups',
  options: [
    sub('buscar', 'Líder del grupo · Añade a tus integrantes a la cola 5v5.'),
    sub('crear', 'Hoster · Abre la cola de una 5v5 competitiva o amistosa.', [{
      type: 3, name: 'modo', description: 'Si lo dejas vacío, se crea una partida competitiva.',
      choices: [{ name: 'Competitiva', value: 'competitiva' }, { name: 'Amistosa (sin nota)', value: 'amistosa' }],
    }]),
    sub('ver', 'Publica el estado actual y los botones de una pickup.', [id]),
    sub('iniciar', 'Hoster de la pickup o administrador · Abre el organizador de equipos.', [id]),
    sub('confirmar', 'Participantes · Confirma que terminó la partida.', [id]),
    sub('votar', 'Participantes · Elige en privado al jugador más valioso.', [id]),
    sub('terminar', 'Organización · Registra o corrige el resultado de la partida.', [id, {
      type: 3, name: 'resultado', description: 'Ganador o empate. Puedes indicar un marcador en su lugar.',
      choices: Object.entries(OUTCOMES).map(([value, name]) => ({ name, value })),
    }, {
      type: 3, name: 'marcador', description: 'Goles Azul-Rojo. Ejemplo 3-1.', max_length: 9,
    }, {
      type: 4, name: 'minutos', description: `Duración al abrir el voto. Predeterminado: ${DEFAULT_VOTE_MINUTES}.`,
      min_value: 1, max_value: 60,
    }]),
    sub('calificar', 'Organización · Abre las notas por equipo o corrige la nota de un jugador.', [id, {
      type: 6, name: 'jugador', description: 'Jugador de la pickup. Déjalo vacío para abrir el formulario.',
    }, {
      type: 3, name: 'nota', description: 'De 0 a 10, con un decimal opcional. Ejemplo: 8.5.', max_length: 4,
    }]),
    sub('cerrar', 'Publica la evaluación competitiva o da por terminada una amistosa.', [id]),
    sub('cancelar', 'Creador o dirección · Cancela la cola o partida.', [id]),
    sub('kick', 'Creador o dirección · Retira a un jugador y libera su cupo.', [id, {
      type: 6, name: 'jugador', description: 'Jugador que quieres retirar de esta pickup.', required: true,
    }]),
  ],
};

export const applicationCommands = [
  pickupCommand,
  { type: 1, name: 'perfil', description: 'Comparte en este canal tu avatar, estrellas, notas y victorias.' },
  { type: 1, name: 'clasificacion', description: 'Muestra los 15 mejores promedios del servidor.' },
  partyCommand,
  { type: 1, name: 'help', description: 'Consulta la guía de partidas, grupos, MVP y clasificación.' },
];
