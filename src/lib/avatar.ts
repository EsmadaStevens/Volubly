// Original identicon-style avatars drawn from a seed. No images are stored or downloaded.

function hash32(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function next(state: number): number {
  // xorshift32
  let x = state || 1
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return x >>> 0
}

export function newAvatarSeed(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function avatarHue(seed: string): number {
  return hash32(seed) % 360
}

/** 5x5 grid, mirrored left to right, always with enough filled cells to look like something. */
export function avatarCells(seed: string): boolean[][] {
  let s = hash32(seed + ':cells')
  const cols: boolean[][] = [[], [], []]
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 5; r++) {
      s = next(s)
      cols[c].push((s & 1) === 1)
    }
  }
  const filled = cols.flat().filter(Boolean).length
  if (filled < 5) for (let r = 0; r < 5; r++) cols[2][r] = true

  const grid: boolean[][] = []
  for (let r = 0; r < 5; r++) {
    grid.push([cols[0][r], cols[1][r], cols[2][r], cols[1][r], cols[0][r]])
  }
  return grid
}

// ---- Characters -------------------------------------------------------------------------
// Each seed picks one body, one set of ears or an antenna, a pair of eyes, a mouth, a cheek
// and a small extra, plus two colours. Everything is chosen from the seed alone, so the same
// seed always draws the same character, and nothing is stored or downloaded.

export const BODIES = ['round', 'squircle', 'egg', 'wide'] as const
export const TOPS = ['none', 'round_ears', 'pointy_ears', 'antenna', 'horns', 'tuft'] as const
export const EYES = ['dots', 'wide', 'sleepy', 'happy', 'wink'] as const
export const MOUTHS = ['smile', 'open', 'flat', 'small_o', 'cat'] as const
export const EXTRAS = ['none', 'sparkle', 'freckles', 'none_blush'] as const

export interface AvatarTraits {
  hue: number
  hue2: number
  body: (typeof BODIES)[number]
  top: (typeof TOPS)[number]
  eyes: (typeof EYES)[number]
  mouth: (typeof MOUTHS)[number]
  extra: (typeof EXTRAS)[number]
  blush: boolean
}

export function avatarTraits(seed: string): AvatarTraits {
  let s = hash32(seed + ':critter')
  const roll = (n: number): number => {
    s = next(s)
    return (s >>> 8) % n
  }
  const hue = avatarHue(seed)
  // The second colour sits 40 to 110 degrees round the colour wheel, so the gradient is never flat.
  const hue2 = (hue + 40 + roll(71)) % 360
  const extra = EXTRAS[roll(EXTRAS.length)]
  return {
    hue,
    hue2,
    body: BODIES[roll(BODIES.length)],
    top: TOPS[roll(TOPS.length)],
    eyes: EYES[roll(EYES.length)],
    mouth: MOUTHS[roll(MOUTHS.length)],
    extra,
    blush: extra === 'none_blush' || roll(3) === 0,
  }
}

/** A short id for the gradient, so two avatars on one page never clash. */
export function avatarGradientId(seed: string): string {
  return `av${hash32(seed).toString(36)}`
}
