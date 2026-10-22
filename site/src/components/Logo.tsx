export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2F6BFF" />
          <stop offset="1" stopColor="#5B3CF0" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill="url(#logo-g)" />
      <path d="M46 78 102 58l52 20 56-20v120l-56 20-52-20-56 20z" fill="#fff" fillOpacity="0.12" stroke="#fff" strokeWidth="11" strokeLinejoin="round" />
      <path d="M102 58v120M154 78v120" stroke="#fff" strokeOpacity="0.5" strokeWidth="9" strokeLinecap="round" />
      <circle cx="78" cy="150" r="13" fill="#fff" />
      <circle cx="182" cy="108" r="17" fill="#FFC53D" />
    </svg>
  );
}

/** GitHub mark (lucide no longer ships brand icons). */
export function GithubMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}
