/**
 * OpenCV.js smoke test in Node: load @techstark/opencv-js through the
 * shared loader and run the full quad-detection pipeline (ALGORITHM.md
 * steps 1-8) on a synthetic frame — a white ID-1-ish rectangle on a dark
 * background, built from raw RGBA arrays (no node-canvas).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadOpenCv, type CV, type ImageDataLike } from '../src/core/opencv-loader';
import { laplacianVariance } from '../src/vision/blur-score';
import { ASPECT_ID1 } from '../src/vision/geometry';
import { detectQuad } from '../src/vision/quad-detector';

const WIDTH = 480;
const HEIGHT = 360;
// White rectangle: x in [80, 400), y in [70, 290) => 320x220, aspect 1.4545
// (within ID-1 tolerance 1.586 +/- 0.25), 40.7% of frame area, centered on
// the guide, 75.8% of the guide area.
const RECT = { x0: 80, y0: 70, x1: 400, y1: 290 };

function syntheticFrame(): ImageDataLike {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const inside = x >= RECT.x0 && x < RECT.x1 && y >= RECT.y0 && y < RECT.y1;
      const v = inside ? 230 : 30;
      const i = (y * WIDTH + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: WIDTH, height: HEIGHT };
}

/**
 * Same card, but with a dark "finger" notch intruding over the bottom edge
 * — this breaks approxPolyDP into >4 vertices; only the convex-hull retry
 * recovers the quad (the real-world hands-holding-the-card case).
 */
function notchedFrame(): ImageDataLike {
  const frame = syntheticFrame();
  const notch = { x0: 200, y0: 240, x1: 260, y1: 290 };
  for (let y = notch.y0; y < notch.y1; y++) {
    for (let x = notch.x0; x < notch.x1; x++) {
      const i = (y * WIDTH + x) * 4;
      frame.data[i] = 30;
      frame.data[i + 1] = 30;
      frame.data[i + 2] = 30;
    }
  }
  return frame;
}

function uniformFrame(value: number): ImageDataLike {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { data, width: WIDTH, height: HEIGHT };
}

/**
 * A bright ellipse on a dark background — a face/head stand-in. It fills a
 * large part of the frame but is NOT a rectangle, so it must never be
 * flagged `cardLike` (the "still face auto-uploads" bug).
 */
function faceBlobFrame(): ImageDataLike {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const rx = 130; // head-ish, near-round (aspect ~1.0)
  const ry = 150;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const v = dx * dx + dy * dy <= 1 ? 230 : 30;
      const i = (y * WIDTH + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: WIDTH, height: HEIGHT };
}

describe('OpenCV.js smoke (Node)', () => {
  let cv: CV;

  beforeAll(async () => {
    cv = await loadOpenCv();
  }, 120_000);

  it('loads the runtime with the shared promise', async () => {
    expect(cv.Mat).toBeTypeOf('function');
    // Second call must reuse the same shared promise/instance.
    const again = await loadOpenCv();
    expect(again).toBe(cv);
  });

  it('detects the synthetic rectangle with ~correct corners', () => {
    const result = detectQuad(cv, syntheticFrame(), ASPECT_ID1);
    try {
      expect(result.processedWidth).toBe(WIDTH); // already at processing size
      expect(result.scaleBack).toBe(1);
      expect(result.reason).toBeNull();
      expect(result.quad).not.toBeNull();
      const quad = result.quad!;
      // Corner tolerance: Canny/dilate localization shifts edges ~1-2 px.
      const expected = [
        [RECT.x0, RECT.y0],
        [RECT.x1, RECT.y0],
        [RECT.x1, RECT.y1],
        [RECT.x0, RECT.y1],
      ];
      for (let i = 0; i < 4; i++) {
        expect(Math.abs(quad[i].x - expected[i][0])).toBeLessThanOrEqual(5);
        expect(Math.abs(quad[i].y - expected[i][1])).toBeLessThanOrEqual(5);
      }
    } finally {
      result.gray.delete();
    }
  });

  it('flags the synthetic card as cardLike', () => {
    const result = detectQuad(cv, syntheticFrame(), ASPECT_ID1);
    try {
      expect(result.cardLike).toBe(true);
    } finally {
      result.gray.delete();
    }
  });

  it('does NOT flag a face-shaped blob as cardLike (still-face guard)', () => {
    const result = detectQuad(cv, faceBlobFrame(), ASPECT_ID1);
    try {
      expect(result.quad).toBeNull(); // not an accepted document
      expect(result.cardLike).toBe(false); // and not card-like either
    } finally {
      result.gray.delete();
    }
  });

  it('recovers the quad via convex hull when a finger notch breaks the edge', () => {
    const result = detectQuad(cv, notchedFrame(), ASPECT_ID1);
    try {
      expect(result.reason).toBeNull();
      expect(result.quad).not.toBeNull();
      expect(result.cardLike).toBe(true);
      const quad = result.quad!;
      // Hull corners still land on the card's true corners.
      const expected = [
        [RECT.x0, RECT.y0],
        [RECT.x1, RECT.y0],
        [RECT.x1, RECT.y1],
        [RECT.x0, RECT.y1],
      ];
      for (let i = 0; i < 4; i++) {
        expect(Math.abs(quad[i].x - expected[i][0])).toBeLessThanOrEqual(6);
        expect(Math.abs(quad[i].y - expected[i][1])).toBeLessThanOrEqual(6);
      }
    } finally {
      result.gray.delete();
    }
  });

  it('reports guideEdgeDensity: card border edges score above a flat wall', () => {
    const card = detectQuad(cv, syntheticFrame(), ASPECT_ID1);
    const flat = detectQuad(cv, uniformFrame(120), ASPECT_ID1);
    try {
      // Density is a fraction in [0, 1].
      expect(card.guideEdgeDensity).toBeGreaterThanOrEqual(0);
      expect(card.guideEdgeDensity).toBeLessThanOrEqual(1);
      // A flat wall has essentially no Canny edges inside the guide.
      expect(flat.guideEdgeDensity).toBeLessThan(0.005);
      // The card's edges give strictly more occupancy than the flat wall.
      expect(card.guideEdgeDensity).toBeGreaterThan(flat.guideEdgeDensity);
    } finally {
      card.gray.delete();
      flat.gray.delete();
    }
  });

  it('passport data page (landscape, ~37% of portrait guide) is cardLike', () => {
    // Portrait passport guide on a 480x360 frame is 204x288 centered
    // (computeGuideRect caps height at 0.8*H). The DATA PAGE alone — a
    // landscape rect in the lower half of the open booklet — must count
    // as a card in view even though it is well under half the guide.
    const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    const page = { x0: 152, y0: 190, x1: 328, y1: 314 }; // 176x124, ratio 1.42
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const inside = x >= page.x0 && x < page.x1 && y >= page.y0 && y < page.y1;
        const v = inside ? 235 : 40;
        const i = (y * WIDTH + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const result = detectQuad(cv, { data, width: WIDTH, height: HEIGHT }, 0.71);
    try {
      expect(result.cardLike).toBe(true);
    } finally {
      result.gray.delete();
    }
  });

  it('finds no quad in a uniform frame', () => {
    const result = detectQuad(cv, uniformFrame(120), ASPECT_ID1);
    try {
      expect(result.quad).toBeNull();
      expect(result.reason).toBe('noQuad');
    } finally {
      result.gray.delete();
    }
  });

  it('laplacianVariance: hard edges score far above a flat image', () => {
    const sharp = detectQuad(cv, syntheticFrame(), ASPECT_ID1);
    const flat = detectQuad(cv, uniformFrame(120), ASPECT_ID1);
    try {
      const sharpScore = laplacianVariance(cv, sharp.gray, {
        x: RECT.x0 - 10,
        y: RECT.y0 - 10,
        width: RECT.x1 - RECT.x0 + 20,
        height: RECT.y1 - RECT.y0 + 20,
      });
      const flatScore = laplacianVariance(cv, flat.gray);
      expect(flatScore).toBeCloseTo(0, 6);
      expect(sharpScore).toBeGreaterThan(120); // above minSharpness
    } finally {
      sharp.gray.delete();
      flat.gray.delete();
    }
  });

  it('warpQuad maps the detected quad onto the full 1011x637 canvas', async () => {
    const { warpQuad } = await import('../src/vision/perspective');
    const frame = syntheticFrame();
    const detection = detectQuad(cv, frame, ASPECT_ID1);
    expect(detection.quad).not.toBeNull();
    const rgba = cv.matFromImageData(frame);
    const warped = warpQuad(cv, rgba, detection.quad!, 1011, 637);
    try {
      expect(warped.cols).toBe(1011);
      expect(warped.rows).toBe(637);
      // Center of the warped document must be the white card interior.
      const centerIdx = (Math.floor(637 / 2) * 1011 + Math.floor(1011 / 2)) * 4;
      expect(warped.data[centerIdx]).toBeGreaterThan(200);
    } finally {
      warped.delete();
      rgba.delete();
      detection.gray.delete();
    }
  });
});
