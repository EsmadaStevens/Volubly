/** @mentions: client-only. A mention is just text in the message; nothing is stored or sent separately. */

export interface MentionQuery {
  /** Index of the "@" in the draft. */
  start: number
  /** What has been typed after it so far. */
  query: string
}

/** Is the caret right after "@something" that began a word? Null when not. */
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([A-Za-z0-9_]{0,20})$/.exec(before)
  if (!m) return null
  return { start: before.length - m[2].length - 1, query: m[2] }
}

/** People whose name starts with what was typed (then ones that contain it), without the person typing. */
export function suggestNames(names: string[], query: string, selfName: string | undefined, limit = 5): string[] {
  const q = query.toLowerCase()
  const self = selfName?.toLowerCase()
  const pool = Array.from(new Set(names)).filter((n) => n.toLowerCase() !== self)
  const starts = pool.filter((n) => n.toLowerCase().startsWith(q))
  const contains = pool.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q))
  return [...starts.sort(), ...contains.sort()].slice(0, limit)
}

/** Swaps "@que" for "@Name " and returns where the caret goes. Null when it would not fit. */
export function completeMention(
  text: string,
  q: MentionQuery,
  caret: number,
  name: string,
  max: number,
): { text: string; cursor: number } | null {
  const spaceFollows = /^\s/.test(text.slice(caret))
  const insert = `@${name}${spaceFollows ? '' : ' '}`
  const next = text.slice(0, q.start) + insert + text.slice(caret)
  if (next.length > max) return null
  return { text: next, cursor: q.start + insert.length + (spaceFollows ? 1 : 0) }
}

export interface Segment {
  text: string
  /** True when this piece is "@name" for someone known in the room. */
  mention: boolean
  /** True when that someone is the reader. */
  me: boolean
}

/** Splits a message so known "@names" can be highlighted. Unknown "@words" stay plain. */
export function splitMentions(body: string, names: string[], myName?: string): Segment[] {
  const known = new Set(names.map((n) => n.toLowerCase()))
  const mine = myName?.toLowerCase()
  const out: Segment[] = []
  const re = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]+)/g
  let last = 0
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const name = m[2].toLowerCase()
    if (!known.has(name)) continue
    const at = m.index + m[1].length
    if (at > last) out.push({ text: body.slice(last, at), mention: false, me: false })
    out.push({ text: `@${m[2]}`, mention: true, me: name === mine })
    last = at + 1 + m[2].length
  }
  if (last < body.length) out.push({ text: body.slice(last), mention: false, me: false })
  return out.length > 0 ? out : [{ text: body, mention: false, me: false }]
}

export const mentionsMe = (body: string, names: string[], myName?: string): boolean =>
  !!myName && splitMentions(body, names, myName).some((s) => s.me)
