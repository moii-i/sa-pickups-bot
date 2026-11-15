import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import gifenc from 'gifenc';
import { lineupScene } from './lineup-scene.js';

const require = createRequire(import.meta.url);
const font = readFileSync(new URL('../assets/lineup/IBMPlexMono-Bold.ttf', import.meta.url));
await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));

function raster(progress) {
  const image = new Resvg(lineupScene(workerData.players, { progress, parties: workerData.parties }), {
    fitTo: { mode: 'width', value: 540 },
    font: { fontBuffers: [font], defaultFontFamily: 'IBM Plex Mono' },
  });
  const frame = image.render();
  try {
    return { width: frame.width, height: frame.height, pixels: frame.pixels };
  } finally {
    frame.free();
    image.free();
  }
}

const { GIFEncoder, applyPalette, quantize } = gifenc;
const encoder = GIFEncoder();
const final = raster(1);
const palette = quantize(final.pixels, 64);
for (let i = 0; i <= 14; i++) {
  const frame = i === 14 ? final : raster(1 - .76 * (1 - i/14) ** 3);
  const pixels = applyPalette(frame.pixels, palette);
  encoder.writeFrame(pixels, frame.width, frame.height, { palette, repeat: 0, delay: i === 14 ? 8000 : 95 });
}
encoder.finish();
parentPort.postMessage(encoder.bytes());
