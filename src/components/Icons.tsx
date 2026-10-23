// Tiny inline icons (no icon library dependency). All inherit currentColor.

type Props = { size?: number; className?: string }
const base = (size = 16) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

export const BoltIcon = ({ size, className }: Props) => (
  <svg {...base(size)} className={className}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>
)
export const CarIcon = ({ size, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M5 17h14M5 17v2M19 17v2M3 13l2-6a2 2 0 0 1 2-1.4h10A2 2 0 0 1 19 7l2 6v4H3v-4z" />
    <circle cx="7.5" cy="13.5" r=".5" /><circle cx="16.5" cy="13.5" r=".5" />
  </svg>
)
export const PinIcon = ({ size, className }: Props) => (
  <svg {...base(size)} className={className}><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg>
)
export const ParkIcon = ({ size, className }: Props) => (
  <svg {...base(size)} className={className}><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M10 17V7h3a3 3 0 0 1 0 6h-3" /></svg>
)
export const CheckIcon = ({ size, className }: Props) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>
)
export const AlertIcon = ({ size, className }: Props) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></svg>
)
export const ExitIcon = ({ size, className }: Props) => (
  <svg {...base(size)} className={className}><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 16l-4-4 4-4M5 12h11" /></svg>
)
