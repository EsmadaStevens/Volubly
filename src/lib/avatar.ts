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
