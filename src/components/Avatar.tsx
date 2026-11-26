import { avatarGradientId, avatarTraits, type AvatarTraits } from '../lib/avatar'

const INK = (h: number) => `hsl(${h} 45% 14%)`

function Body({ t }: { t: AvatarTraits }) {
  const fill = `hsl(${t.hue} 78% 70%)`
  switch (t.body) {
    case 'squircle':
      return <rect x="22" y="27" width="56" height="56" rx="20" fill={fill} />
    case 'egg':
      return <path d="M50 22 C70 22 80 42 78 58 C76 76 62 84 50 84 C38 84 24 76 22 58 C20 42 30 22 50 22 Z" fill={fill} />
    case 'wide':
      return <ellipse cx="50" cy="57" rx="31" ry="26" fill={fill} />
    default:
      return <circle cx="50" cy="55" r="29" fill={fill} />
  }
}

// Ears, horns, antenna: drawn first so the body overlaps them.
function Top({ t }: { t: AvatarTraits }) {
  const dark = `hsl(${t.hue} 65% 52%)`
  const accent = `hsl(${t.hue2} 85% 72%)`
  switch (t.top) {
    case 'round_ears':
      return (
        <>
          <circle cx="30" cy="31" r="10" fill={dark} />
          <circle cx="70" cy="31" r="10" fill={dark} />
        </>
      )
    case 'pointy_ears':
      return (
        <>
          <polygon points="23,44 29,14 46,30" fill={dark} />
          <polygon points="77,44 71,14 54,30" fill={dark} />
        </>
      )
    case 'antenna':
      return (
        <>
          <line x1="50" y1="30" x2="50" y2="13" stroke={dark} strokeWidth="4" strokeLinecap="round" />
          <circle cx="50" cy="11" r="6" fill={accent} />
        </>
      )
    case 'horns':
      return (
        <>
          <circle cx="35" cy="26" r="7" fill={accent} />
          <circle cx="65" cy="26" r="7" fill={accent} />
        </>
      )
    case 'tuft':
      return (
        <g stroke={dark} strokeWidth="4" strokeLinecap="round" fill="none">
          <path d="M44 28 C42 20 40 17 37 15" />
          <path d="M50 26 C50 17 50 13 50 10" />
          <path d="M56 28 C58 20 60 17 63 15" />
        </g>
      )
    default:
      return null
  }
}

function Eyes({ t }: { t: AvatarTraits }) {
  const ink = INK(t.hue)
  const y = 52
  switch (t.eyes) {
    case 'wide':
      return (
        <>
          <circle cx="40" cy={y} r="7" fill="#fff" />
          <circle cx="60" cy={y} r="7" fill="#fff" />
          <circle cx="41.5" cy={y + 0.5} r="3.6" fill={ink} />
          <circle cx="61.5" cy={y + 0.5} r="3.6" fill={ink} />
        </>
      )
    case 'sleepy':
      return (
        <g stroke={ink} strokeWidth="3.4" strokeLinecap="round" fill="none">
          <path d={`M34 ${y} Q40 ${y + 5} 46 ${y}`} />
          <path d={`M54 ${y} Q60 ${y + 5} 66 ${y}`} />
        </g>
      )
    case 'happy':
      return (
        <g stroke={ink} strokeWidth="3.4" strokeLinecap="round" fill="none">
          <path d={`M34 ${y + 3} Q40 ${y - 5} 46 ${y + 3}`} />
          <path d={`M54 ${y + 3} Q60 ${y - 5} 66 ${y + 3}`} />
        </g>
      )
    case 'wink':
      return (
        <>
          <circle cx="40" cy={y} r="4.6" fill={ink} />
          <path d={`M54 ${y + 2} Q60 ${y - 5} 66 ${y + 2}`} stroke={ink} strokeWidth="3.4" strokeLinecap="round" fill="none" />
        </>
      )
    default:
      return (
        <>
          <circle cx="40" cy={y} r="4.8" fill={ink} />
          <circle cx="60" cy={y} r="4.8" fill={ink} />
          <circle cx="41.6" cy={y - 1.6} r="1.4" fill="#fff" />
          <circle cx="61.6" cy={y - 1.6} r="1.4" fill="#fff" />
        </>
      )
  }
}

function Mouth({ t }: { t: AvatarTraits }) {
  const ink = INK(t.hue)
  switch (t.mouth) {
    case 'open':
      return (
        <>
          <path d="M40 64 Q50 78 60 64 Z" fill={ink} />
          <path d="M45 70 Q50 75 55 70 Q50 68 45 70 Z" fill="hsl(350 85% 68%)" />
        </>
      )
    case 'flat':
      return <line x1="43" y1="68" x2="57" y2="68" stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
    case 'small_o':
      return <ellipse cx="50" cy="68" rx="3.8" ry="4.6" fill={ink} />
    case 'cat':
      return <path d="M42 66 Q46 72 50 66 Q54 72 58 66" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
    default:
      return <path d="M41 65 Q50 75 59 65" stroke={ink} strokeWidth="3.4" strokeLinecap="round" fill="none" />
  }
}

function Extra({ t }: { t: AvatarTraits }) {
  const ink = INK(t.hue)
  return (
    <>
      {t.blush && (
        <>
          <circle cx="31" cy="62" r="5.5" fill="hsl(345 90% 70%)" opacity="0.5" />
          <circle cx="69" cy="62" r="5.5" fill="hsl(345 90% 70%)" opacity="0.5" />
        </>
      )}
      {t.extra === 'freckles' && (
        <g fill={ink} opacity="0.45">
          <circle cx="33" cy="60" r="1.5" />
          <circle cx="37" cy="63" r="1.5" />
          <circle cx="63" cy="63" r="1.5" />
          <circle cx="67" cy="60" r="1.5" />
        </g>
      )}
      {t.extra === 'sparkle' && (
        <path d="M80 18 L82.2 24 L88 26 L82.2 28 L80 34 L77.8 28 L72 26 L77.8 24 Z" fill={`hsl(${t.hue2} 90% 80%)`} />
      )}
    </>
  )
}

/** A small original character drawn from the seed. The same seed always gives the same one. */
export default function Avatar({ seed, size = 40 }: { seed: string; size?: number }) {
  const t = avatarTraits(seed)
  const gid = avatarGradientId(seed)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Avatar"
      className="shrink-0 rounded-full"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${t.hue} 45% 24%)`} />
          <stop offset="1" stopColor={`hsl(${t.hue2} 55% 34%)`} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gid})`} />
      <Top t={t} />
      <Body t={t} />
      <ellipse cx="40" cy="38" rx="9" ry="4.5" fill="#fff" opacity="0.2" transform="rotate(-20 40 38)" />
      <Eyes t={t} />
      <Mouth t={t} />
      <Extra t={t} />
    </svg>
  )
}
