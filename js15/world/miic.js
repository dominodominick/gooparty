// Mii data from the Mii creator (the open-source Mii Maker in mii/): its own "miic" format (version 4, 124 bytes, the
// creator's MiiCreatorV4Data) or a 3DS/Wii U FFLStoreData (96 bytes). The game turns it into what the Mii renderer (FFL)
// takes: StudioData (46 bytes, which keeps the Switch's extra colours), and reads the few things the body needs
// (favourite colour, height, build, gender, skin colour, name).

// MiiCreatorV4Data, field by field (src/class/struct/MiiCreatorV4Data.ts in the creator). 'id8'/'id10' are byte runs,
// 'name' is 10 UTF-16LE characters, 'u16' a little-endian number; everything else one byte.
const V4 = [
  ['miicVersion'], ['originPlatform'], ['authorId', 'id8'], ['createId', 'id10'], ['creator', 'name'], ['nickname', 'name'],
  ['beardColor'], ['beardType'], ['birthDay'], ['birthMonth'], ['birthYear', 'u16'], ['build'], ['eyeAspect'], ['eyebrowAspect'],
  ['eyebrowColor'], ['eyebrowRotate'], ['eyebrowScale'], ['eyebrowType'], ['eyebrowX'], ['eyebrowY'], ['eyeColor'], ['eyeRotate'],
  ['eyeScale'], ['eyeType'], ['eyeX'], ['eyeY'], ['facelineColor'], ['facelineMake'], ['facelineType'], ['facelineWrinkle'],
  ['facePaintColor'], ['favorite'], ['favoriteColor'], ['fontRegion'], ['gender'], ['glassColor'], ['glassScale'], ['glassType'],
  ['glassY'], ['hairColor'], ['hairFlip'], ['hairType'], ['hatFavoriteColor'], ['hatCommonColor'], ['hatType'], ['height'],
  ['wigType'], ['moleScale'], ['moleType'], ['moleX'], ['moleY'], ['mouthAspect'], ['mouthColor'], ['mouthScale'], ['mouthType'],
  ['mouthY'], ['mustacheScale'], ['mustacheType'], ['mustacheY'], ['noseScale'], ['noseType'], ['noseY'], ['pantsColor'],
  ['personality'], ['regionMove'], ['shirtColor'], ['special'], ['temporary'], ['eyeSclera'], ['clothesType'], ['shoesColor'],
];
const SIZE = { id8: 8, id10: 10, name: 20, u16: 2 };
export const MIIC_V4_SIZE = V4.reduce((n, [, t]) => n + (SIZE[t] || 1), 0); // 124

// StudioData (src/class/struct/StudioData.ts): 46 bytes, alphabetical.
const STUDIO = ['beardColor', 'beardType', 'build', 'eyeAspect', 'eyeColor', 'eyeRotate', 'eyeScale', 'eyeType', 'eyeX', 'eyeY',
  'eyebrowAspect', 'eyebrowColor', 'eyebrowRotate', 'eyebrowScale', 'eyebrowType', 'eyebrowX', 'eyebrowY', 'facelineColor',
  'facelineMake', 'facelineType', 'facelineWrinkle', 'favoriteColor', 'gender', 'glassColor', 'glassScale', 'glassType', 'glassY',
  'hairColor', 'hairFlip', 'hairType', 'height', 'moleScale', 'moleType', 'moleX', 'moleY', 'mouthAspect', 'mouthColor',
  'mouthScale', 'mouthType', 'mouthY', 'mustacheScale', 'mustacheType', 'mustacheY', 'noseScale', 'noseType', 'noseY'];

// The Mii favourite colours (the Wii's twelve), as the shirt is drawn.
export const FAVORITE_COLORS = ['#d21e14', '#ff6e19', '#ffd820', '#78d220', '#007830', '#0a48b4', '#3caade', '#f55a7d', '#7328ad', '#483818', '#e0e0e0', '#181814'];
// Skin (the faceline colours: the Wii's six, then the Switch's four), for the hands.
export const SKIN_COLORS = ['#ffd3ad', '#ffb68f', '#de7952', '#ffaa8c', '#ad5129', '#632c18', '#ffd3be', '#ffb68f', '#c06a3e', '#3f1e10'];

/** base64 -> bytes (browser or node). */
export function fromBase64(s) {
  if (typeof atob === 'function') { const b = atob(String(s).trim()), out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; }
  return new Uint8Array(Buffer.from(String(s), 'base64'));
}
export function toBase64(u8) {
  if (typeof btoa === 'function') { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  return Buffer.from(u8).toString('base64');
}

/** The fields of a miic v4 Mii (or null if it is not one). */
export function readMiic(bytes) {
  if (!bytes || bytes.length < MIIC_V4_SIZE - 3 || bytes[0] !== 4) return null; // (older ones stop before the clothes fields)
  const o = {}; let p = 0;
  for (const [k, t] of V4) {
    if (p >= bytes.length) { o[k] = 0; continue; }
    if (t === 'id8' || t === 'id10') { o[k] = bytes.slice(p, p + SIZE[t]); p += SIZE[t]; }
    else if (t === 'name') { let s = ''; for (let i = 0; i < 10; i++) { const c = bytes[p + 2 * i] | (bytes[p + 2 * i + 1] << 8); if (!c) break; s += String.fromCharCode(c); } o[k] = s; p += 20; }
    else if (t === 'u16') { o[k] = bytes[p] | (bytes[p + 1] << 8); p += 2; }
    else o[k] = bytes[p++];
  }
  return o;
}

/** A 96-byte FFLStoreData's few body fields (its bit layout, as FFL's FFLiMiiDataCore). */
function readStoreData(b) {
  const flags = b[0x18] | (b[0x19] << 8); // birth/gender/favourite colour word
  let name = ''; for (let i = 0; i < 10; i++) { const c = b[0x1a + 2 * i] | (b[0x1b + 2 * i] << 8); if (!c) break; name += String.fromCharCode(c); }
  return { gender: flags & 1, favoriteColor: (flags >> 10) & 15, nickname: name, height: b[0x2e], build: b[0x2f], facelineColor: (b[0x30] >> 5) & 7 };
}

/**
 * Everything the game needs from a Mii (a base64 string as the creator gives it):
 *   { ffl: bytes FFL can draw (StudioData or FFLStoreData), name, gender, favoriteColor, height, build, skin }
 * or null if it is not Mii data the game knows.
 */
export function parseMii(b64) {
  let bytes;
  try { bytes = fromBase64(b64); } catch (e) { return null; }
  const m = readMiic(bytes);
  if (m) {
    const s = new Uint8Array(STUDIO.length);
    STUDIO.forEach((k, i) => { s[i] = m[k] & 255; });
    if (m.facePaintColor !== 255 && m.facePaintColor < 200) s[STUDIO.indexOf('facelineColor')] = m.facePaintColor + 10; // (face paint, as the creator does)
    return { ffl: s, name: m.nickname || 'Mii', gender: m.gender, favoriteColor: m.favoriteColor % 12, height: m.height, build: m.build, skin: m.facelineColor };
  }
  if (bytes.length === 96) { const d = readStoreData(bytes); return { ffl: bytes, name: d.nickname || 'Mii', gender: d.gender, favoriteColor: d.favoriteColor % 12, height: d.height, build: d.build, skin: d.facelineColor }; }
  return null;
}

/** Guest Miis (the creator's own six guests, A to F, then two more): the computer players wear these. */
export const GUEST_MIIS = [
  'BAM5i2G9mwPpOoAAAADs/4LSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEcAdQBlAHMAdAAgAEEAAAAAAAAACAAAAAAAQAMDCAYEBgIKCAQEAgIMBAAAAP8ABAAACAQACggARP///0AABAACFAMTBBcNBAAKBAEJ//8A/wAAAA==',
  'BAOFdPR8ZsuhdoAAAAHs/4LSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEcAdQBlAHMAdAAgAEIAAAAAAAAACAAAAAAAQAMDBgYEBgIKDAQEAgIMAAAAAP8ABQAACAQACgYAN////0AABAACFAMTBBcNBAAKBAEJ//8A/wAAAA==',
  'BAM2I3afbKlshYAAAALs/4LSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEcAdQBlAHMAdAAgAEMAAAAAAAAACAAAAAAAQAMDAQYEBgIKCAQEAgIMAQAAAP8AAAAACAQACgEAIf///0AABAACFAMTBBcNBAAKBAEJ//8A/wAAAA==',
  'BAN9s2CERcxd8IAAAAPs/4LSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEcAdQBlAHMAdAAgAEQAAAAAAAAACAAAAAAAQAMDCAYEAAIKCAMEBAIMAgAAAP8AAgABCAQACggAGP///0AABAACFAMTBBcNBAAKBAEJ//8A/wAAAA==',
  'BAP3BYyHQ6gZsoAAAATs/4LSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEcAdQBlAHMAdAAgAEUAAAAAAAAACAAAAAAAQAMDBwYEAAIKDQMEBAIMAAAAAP8ABgABCAQACgcADv///0AABAACFAMTBBcNBAAKBAEJ//8A/wAAAA==',
  'BANfFfqpycZfsoAAAAXs/4LSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEcAdQBlAHMAdAAgAEYAAAAAAAAACAAAAAAAQAMDAQYEAAIKCAMEBAIMAAAAAP8ABwABCAQACgEADP///0AABAACFAMTBBcNBAAKBAEJ//8A/wAAAA==',
];
/** The creator's default new Mii (a boy, as its "Create Mii" starts). */
export const DEFAULT_MII = 'BAXGigDvV8wSNID/cJl869TJwxYAAAAAAAAAAAAAAAAAAAAAAAAAAE0AaQBpAAAAAAAAAAAAAAAAAAAACAAAAAAAQAMDAQYEBgIKCAQEAgIMAAAAAP8AAAAACAQACgEAIf///0AABAACFAMTBBcNBAAKBAEJ//8A/wAAAP//';
