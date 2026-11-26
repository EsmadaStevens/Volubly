/**
 * A small, fixed set of everyday emoji. No outside library and no network: nothing is loaded
 * from anywhere, so it adds no tracking and works offline. Plain emoji only (no skin-tone or
 * joined sequences), so each one is a predictable length and shows on older phones.
 */
export interface EmojiGroup {
  id: string
  label: string
  icon: string
  emoji: string[]
}

const list = (s: string): string[] => s.split(/\s+/).filter(Boolean)

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: 'faces',
    label: 'Faces',
    icon: '😀',
    emoji: list('😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 😘 😋 😛 😜 🤪 😎 🤔 🤨 😐 😑 🙄 😏 😴 😢 😭 😤 😡 😱 😳 🥺 🤯 🥳 🤗'),
  },
  {
    id: 'hands',
    label: 'Hands',
    icon: '👍',
    emoji: list('👍 👎 👏 🙌 🙏 🤝 👋 ✌️ 🤞 👌 🤟 🤘 💪 👀 🤷 🤦 🙈 🙉 🙊 💀'),
  },
  {
    id: 'hearts',
    label: 'Hearts',
    icon: '❤️',
    emoji: list('❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💖 💗 💯 ✨ ⭐ 🌟 ⚡ 💥 🔥 ✅ ❌ ❗ ❓ 💤'),
  },
  {
    id: 'fun',
    label: 'Fun',
    icon: '🎉',
    emoji: list('🎉 🎊 🎁 🏆 🥇 ⚽ 🏀 🏈 🏏 🎮 🎵 🎶 🎤 🎧 📺 🍿 🎬 📱 💻 🚗 ✈️ 🚀 💡 📣'),
  },
  {
    id: 'nature',
    label: 'Nature & food',
    icon: '🌍',
    emoji: list('🌍 ☀️ 🌤️ ☁️ 🌧️ ⛈️ 🌈 ❄️ 🌸 🌻 🌴 🐶 🐱 🐘 🦁 🍕 🍔 🍟 🌮 🍰 🍫 ☕ 🍺 🥤'),
  },
]

/**
 * Inserts text at the cursor (replacing any selected text) and says where the cursor should go.
 * Lengths are counted the way the message box counts them, so the limit matches what it enforces.
 * Returns null when the result would be over the limit, so nothing is changed.
 */
export function insertAt(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  insert: string,
  max: number,
): { text: string; cursor: number } | null {
  const a = Math.max(0, Math.min(selectionStart, text.length))
  const b = Math.max(a, Math.min(selectionEnd, text.length))
  const next = text.slice(0, a) + insert + text.slice(b)
  if (next.length > max) return null
  return { text: next, cursor: a + insert.length }
}
