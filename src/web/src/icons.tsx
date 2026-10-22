// The Cartograph mark: a compass with a vermilion needle (same as the landing page).
export function CartographLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden style={{ flexShrink: 0 }}>
      <rect width="64" height="64" rx="14" fill="#1c1a16" />
      <circle cx="32" cy="32" r="19" fill="none" stroke="#f2ede1" strokeWidth="3" />
      <path d="M32 9v8M32 47v8M9 32h8M47 32h8" stroke="#f2ede1" strokeWidth="3" strokeLinecap="round" />
      <path d="M32 20l5 12-5 12-5-12z" fill="#d9442b" />
    </svg>
  );
}
