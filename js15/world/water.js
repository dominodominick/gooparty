// The look and the motion of the island's water: the river, its pools and waterfalls, and the sea round the island.
// Nothing in here needs three.js, so the tests can run it (the loader, islandLoader.js, plugs it into the real map).
//
// On the Wii the water surface is not a picture of water: its texture holds two grey ripple patterns (one in the colour,
// one in the alpha) that the console used to bend other textures, and the blue came from the material. Converted, that
// texture was simply drawn, tinted blue, so the water was speckled with black wherever the pattern is dark.
// Here the pattern is turned into a blue water texture with gentle light and dark, and every water layer slides along,
// as it does in the game: the map's UVs run along the flow, so sliding a texture makes the water run down the falls.

/** The two blues the ripple pattern is spread between (sRGB, 0..255), sampled from the real game. Nothing darker than `lo`. */
export const WATER_BLUE = { lo: [38, 104, 188], hi: [74, 146, 214] };

/**
 * How fast each layer's texture slides, in texture lengths per second, as [u, v].
 * A texture moves the opposite way to its offset. Down a waterfall is +u on the surface and +v on the wave lines, so
 * both of those go negative. (On the falls 1 texture length is about 1300 map units on the surface and 720 on the wave lines.)
 */
export const WATER_FLOW = {
  surface: [-0.3, 0.03],   // the river, pools and falls
  sea: [-0.04, 0.015],     // the sea round the island: a slow drift
  waves: [0, -0.8],        // the light wavy lines that run down the falls and along the river
  caustics: [0.09, 0.06],  // the net of light on the pools
  foam: [0.02, 0],         // foam along the shores (it does not repeat across the shore, so it only slides along it)
};

/**
 * Turn the grey ripple texture's pixels (RGBA bytes, changed in place) into blue water.
 * `alpha` is the alpha every pixel gets: 255 for the river, less for the sea layer that lets the sea-floor colours through.
 */
export function recolourWater(px, alpha = 255) {
  const { lo, hi } = WATER_BLUE;
  for (let i = 0; i < px.length; i += 4) {
    let n = (0.6 * px[i] + 0.4 * px[i + 3]) / 255; // both ripple patterns, mixed
    n = Math.min(1, Math.max(0, (n - 0.2) / 0.6));
    n = n * n * (3 - 2 * n);                        // soft steps, no hard edges
    px[i] = Math.round(lo[0] + (hi[0] - lo[0]) * n);
    px[i + 1] = Math.round(lo[1] + (hi[1] - lo[1]) * n);
    px[i + 2] = Math.round(lo[2] + (hi[2] - lo[2]) * n);
    px[i + 3] = alpha;
  }
  return px;
}

/** A canvas holding the blue version of the ripple texture `image` (an image, bitmap or canvas). */
export function waterCanvas(image, alpha = 255, doc = document) {
  const w = image.width, h = image.height, c = doc.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0);
  const d = g.getImageData(0, 0, w, h);
  recolourWater(d.data, alpha);
  g.putImageData(d, 0, 0);
  return c;
}

/** Slides textures along: add each texture once with its speed, then call update(dt) every frame. */
export class WaterFlow {
  constructor() { this.items = []; }

  /** `tex` needs an `offset` with x and y (a three.js texture has one). The same texture is only added once. */
  add(tex, u, v) {
    if (tex && tex.offset && !this.items.some((it) => it.tex === tex)) this.items.push({ tex, u, v });
    return tex;
  }

  update(dt) {
    if (!(dt > 0)) return;
    for (const { tex, u, v } of this.items) {
      // kept between -2 and 2: a whole number of repeats (or a pair of mirrored ones) looks the same, and small numbers stay exact
      tex.offset.x = (tex.offset.x + u * dt) % 2;
      tex.offset.y = (tex.offset.y + v * dt) % 2;
    }
  }
}
