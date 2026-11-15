import { lineupScene } from '/alineacion/escena.js';
import { PARTY_BADGES } from '/alineacion/arcade.js';

const access = document.querySelector('[data-access]');
const view = document.querySelector('[data-view]');
const code = document.querySelector('[data-code]');
const instructions = document.querySelector('[data-instructions]');
const renew = document.querySelector('[data-renew]');
const pitch = document.querySelector('[data-pitch]');
const roster = document.querySelector('[data-roster]');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let players, parties = [], yaw = 0, tilt = 1.39, progress = 1, animation, drag;
let synchronized = false;
let rosterSnapshot;

function draw() {
  if (players) pitch.innerHTML = lineupScene(players, { yaw, tilt, progress, parties });
}

function animate(targetYaw, targetTilt, entrance = false) {
  cancelAnimationFrame(animation);
  const start = performance.now();
  const initial = [yaw, tilt];
  if (reduceMotion.matches) {
    [yaw, tilt, progress] = [targetYaw, targetTilt, 1];
    draw();
    return;
  }
  function frame(now) {
    const t = Math.min(1, Math.max(0, (now - start)/(entrance ? 1350 : 400)));
    const eased = 1 - (1-t)**3;
    yaw = initial[0] + (targetYaw-initial[0])*eased;
    tilt = initial[1] + (targetTilt-initial[1])*eased;
    progress = entrance ? .24+.76*eased : 1;
    draw();
    if (t < 1) animation = requestAnimationFrame(frame);
  }
  animation = requestAnimationFrame(frame);
}

function unavailable(message) {
  cancelAnimationFrame(animation);
  players = undefined;
  pitch.replaceChildren();
  roster.replaceChildren();
  view.hidden = true;
  access.hidden = false;
  code.textContent = '';
  instructions.textContent = message;
}

async function refresh() {
  try {
    const response = await fetch(location.pathname + '/datos', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (response.status === 404) return unavailable('La alineación dejó de estar disponible para esta sesión.');
    if (response.status === 409) {
      unavailable('Buscando reemplazo. La alineación aparecerá cuando se complete de nuevo.');
      synchronized = false;
      setTimeout(refresh, 3500);
      return;
    }
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (data.players) {
      players = data.players;
      parties = data.parties ?? [];
      const snapshot = JSON.stringify([players, parties]);
      if (!synchronized || rosterSnapshot !== snapshot) {
        synchronized = true;
        rosterSnapshot = snapshot;
        document.querySelector('[data-match]').textContent = `PICKUP #${data.id}`;
        const rosterLines = parties.map((p) => `${PARTY_BADGES[p.badge]?.icon ?? ''} ${p.side === 'A' ? 'Azul' : 'Rojo'} · ${p.name}`);
        rosterLines.push(...players.map((p) => `${p.team === 'A' ? 'Azul' : 'Rojo'} · #${String(p.number).padStart(2, '0')} ${p.position} · ${p.label}`));
        roster.replaceChildren(...rosterLines.map((line) => {
          const item = document.createElement('li');
          item.textContent = line;
          return item;
        }));
        access.hidden = true;
        view.hidden = false;
        animate(-.22, 1.04, true);
      }
    } else if (data.code) {
      code.textContent = data.code;
    } else {
      unavailable('El código o la sesión venció. Obtén otro para continuar.');
      renew.hidden = false;
      return;
    }
  } catch {
    if (!synchronized) code.textContent = 'Reconectando…';
  }
  setTimeout(refresh, synchronized ? 8000 : 2300);
}

for (const button of document.querySelectorAll('[data-camera]')) {
  button.addEventListener('click', () => {
    const action = button.dataset.camera;
    if (action === 'top') animate(0, 1.39);
    else animate(yaw + (action === 'right' ? .40 : -.40), 1.04);
  });
}
document.querySelector('[data-replay]').addEventListener('click', () => animate(-.22, 1.04, true));
renew.addEventListener('click', () => location.reload());
pitch.addEventListener('pointerdown', (event) => {
  cancelAnimationFrame(animation);
  drag = { id: event.pointerId, x: event.clientX, yaw };
  pitch.setPointerCapture(event.pointerId);
});
pitch.addEventListener('pointermove', (event) => {
  if (drag?.id !== event.pointerId) return;
  yaw = drag.yaw + (event.clientX - drag.x) * .008;
  tilt = 1.04;
  progress = 1;
  draw();
});
for (const event of ['pointerup','pointercancel','lostpointercapture']) {
  pitch.addEventListener(event, () => { drag = undefined; });
}
void refresh();
