// The Cartograph logo (same artwork as the ChatGPT plugin icon).
import { useId } from "react";

export function CartographLogo({ size = 22 }: { size?: number }) {
  // The app icon: folded map, a request's stops, and its destination.
  const id = `cg-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2F6BFF" />
          <stop offset="1" stopColor="#5B3CF0" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill={`url(#${id})`} />
      <path d="M46 78 102 58l52 20 56-20v120l-56 20-52-20-56 20z" fill="#fff" fillOpacity="0.12" stroke="#fff" strokeWidth="14" strokeLinejoin="round" />
      <path d="M102 58v120M154 78v120" stroke="#fff" strokeOpacity="0.5" strokeWidth="11" strokeLinecap="round" />
      <circle cx="76" cy="160" r="16" fill="#fff" />
      <circle cx="128" cy="126" r="16" fill="#fff" />
      <circle cx="182" cy="106" r="20" fill="#FFC53D" />
    </svg>
  );
}
