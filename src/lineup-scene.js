import { PARTY_BADGES } from './arcade.js';

export const SCENE_WIDTH = 780;
export const SCENE_HEIGHT = 850;
const font = 'IBM Plex Mono,monospace';
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const teams = {
  A: { shirt: '#3679e6', edge: '#194993' },
  B: { shirt: '#ed4e67', edge: '#982c41' },
};
const positions = {
  GK: [0, -8.2], CM: [0, -4.9], Winger: [6.1, -4.9], CF: [0, -1.75],
};

export function lineupPlayers(roster) {
  const wings = { A: 0, B: 0 };
  return roster.map(({ team, position, name }) => {
    const cleanName = name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim() || 'Jugador';
    const parts = Array.from(graphemes.segment(cleanName), ({ segment }) => segment);
    const label = parts.length > 13 ? parts.slice(0, 12).join('') + '…' : cleanName;
    const number = position === 'Winger' ? [7, 11][wings[team]++] : { GK: 1, CM: 4, CF: 9 }[position];
    return { team, position, label, number };
  });
}

export function lineupParties(roster) {
  const identities = new Map();
  for (const { team, party_id, party_name, party_badge } of roster) {
    if (party_id && party_name && Object.hasOwn(PARTY_BADGES, party_badge)) {
      identities.set(`${team}:${party_id}`, { side: team, name: party_name, badge: party_badge });
    }
  }
  return [...identities.values()];
}

function escapeText(value) {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

export function lineupScene(players, { yaw = 0, tilt = 1.39, zoom = 1, progress = 1, title = 'ALINEACIÓN 5V5', parties = [] } = {}) {
  const w = SCENE_WIDTH, h = SCENE_HEIGHT;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const lift = Math.cos(tilt), depth = Math.sin(tilt);
  const scale = zoom * Math.min(688 / (18.6 * Math.abs(cos) + 21.4 * Math.abs(sin)), 661 / (depth * (18.6 * Math.abs(sin) + 21.4 * Math.abs(cos)) + 1.7 * lift));
  const project = ([x,z,y = 0]) => [w/2 + (x*cos - z*sin)*scale, 459 + ((x*sin + z*cos)*depth-y*lift)*scale];
  const poly = (points, fill, stroke = 'none') =>
    `<polygon points="${points.map(p => project(p).map(n => n.toFixed(1)).join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>`;
  const rect = (x1,z1,x2,z2,y = 0) => [[x1,z1,y],[x2,z1,y],[x2,z2,y],[x1,z2,y]];
  const circle = (x,z,r) => Array.from({length:32}, (_,i) => [x+Math.cos(i*Math.PI/16)*r,z+Math.sin(i*Math.PI/16)*r]);
  const label = (x,y,value,size = 22,fill = '#fff',anchor = 'middle') =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${fill}" font-family="${font}" font-weight="700" font-size="${size}" text-anchor="${anchor}">${escapeText(value)}</text>`;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Alineación 5v5 de SA Pickups">`,
    `<rect width="${w}" height="${h}" fill="#0b0b0b"/><path d="M26 26h56M26 26v24M754 26h-56M754 26v24M26 824h56M26 824v-24M754 824h-56M754 824v-24" fill="none" stroke="#c1c1c1" stroke-width="3"/>`,
    label(w/2,43,'SA PICKUPS',19,'#c1c1c1'), label(w/2,81,title,32),
    poly(rect(-9.3,-10.7,9.3,10.7,-.23),'#363636'),
    poly(rect(-9.3,-10.7,9.3,10.7),'#1d1d1d','#777'),
  ];
  for (let i = -10; i < 10; i += 4) parts.push(poly(rect(-8.9,i,8.9,i+2),'#252525'));
  parts.push(poly(rect(-8.9,-10,8.9,10),'none','#777'),
    poly(rect(-8.9,-.014,8.9,.014),'#777'),poly(circle(0,0,1.65),'none','#777'));
  for (const side of [-1,1]) {
    parts.push(poly(rect(-2.6,side*7.9,2.6,side*10),'none','#777'),
      poly(rect(-1.5,side*10,1.5,side*10.58,.32),'none','#999'));
  }
  const [a,b] = ['A','B'].map(team => players.filter(p => p.team === team).length);
  for (const [side, teamName, count, x, anchor] of [['A','AZUL',a,63,'start'], ['B','ROJO',b,716,'end']]) {
    const groups = parties.filter((p) => p.side === side);
    parts.push(label(x, groups.length ? 785 : 807, `${teamName} ${count}/5`, 21, '#eee', anchor));
    if (!groups.length) continue;
    const [first] = groups;
    const badgeX = side === 'A' ? x : x - 15;
    const badge = PARTY_BADGES[first.badge];
    badge?.pixels.split('/').forEach((line, row) => [...line].forEach((pixel, column) => {
      if (pixel === '1') parts.push(`<rect x="${badgeX+column*3}" y="${796+row*3}" width="3" height="3" fill="#eee"/>`);
    }));
    const suffix = groups.length > 1 ? ` +${groups.length - 1}` : '';
    parts.push(label(side === 'A' ? x + 22 : x - 22, 810, first.name + suffix, 17, '#eee', anchor));
  }
  const wings = { A: 0, B: 0 };
  const placed = players.flatMap((p) => {
    const spot = positions[p.position];
    if (!spot || !teams[p.team]) return [];
    const direction = p.team === 'A' ? 1 : -1;
    const x = p.position === 'Winger' ? spot[0] * (wings[p.team]++ % 2 === 0 ? -1 : 1) : spot[0];
    return [{ ...p, x, z: spot[1]*direction, direction }];
  });
  placed.sort((a,b) => project([a.x,a.z])[1] - project([b.x,b.z])[1]);

  function block(x,z,bottom,top,width,length,front,side,cap) {
    const l=x-width/2, r=x+width/2, far=z-length/2, near=z+length/2;
    const edge = sin > 0 ? r : l;
    parts.push(poly([[edge,far,bottom],[edge,near,bottom],[edge,near,top],[edge,far,top]],side),
      poly([[l,near,bottom],[r,near,bottom],[r,near,top],[l,near,top]],front),
      poly(rect(l,far,r,near,top),cap));
  }
  const labels = [];
  for (const p of placed) {
    const { shirt, edge } = teams[p.team];
    const offset = (1-progress) * (10.9-Math.abs(p.z));
    const x = p.x, z = p.z - p.direction*offset;
    const [px,py] = project([p.x,p.z,1.65]);
    labels.push([px,py,p]);
    parts.push(poly(circle(x,z,.62),'#101010'));
    block(x-.19,z,0,.53,.27,.40,'#aaa','#515151','#cecece');
    block(x+.19,z,0,.53,.27,.40,'#aaa','#515151','#cecece');
    block(x-.46,z,.52,1.05,.20,.32,edge,'#343434',shirt);
    block(x+.46,z,.52,1.05,.20,.32,edge,'#343434',shirt);
    block(x,z,.48,1.17,.73,.47,shirt,edge,shirt);
    block(x,z,1.17,1.67,.52,.47,'#cecece','#888','#fff');
  }
  for (const [x,y,p] of labels) {
    const size = p.label.length > 10 ? 21 : 26;
    const boxWidth = Math.max(78, Math.min(186, p.label.length*size*.62+14));
    parts.push(`<rect x="${(x-boxWidth/2).toFixed(1)}" y="${(y-58).toFixed(1)}" width="${boxWidth}" height="45" rx="4" fill="#101010"/>`,
      label(x,y-34,p.label,size),label(x,y-16,`${p.number ? `#${String(p.number).padStart(2,'0')} · ` : ''}${p.position.toUpperCase()}`,17,'#ddd'));
  }
  return parts.join('') + '</svg>';
}
