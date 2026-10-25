// The desk's header and footer, in the landing page's language: compass mark and
// serif name on the left, an ink rule beneath, mono labels in the footer.
import type { ReactNode } from "react";
import { CartographLogo } from "./icons";

export const REPO_URL = "https://github.com/prabhat-gp/cartograph-hackathon";

export function GithubMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

/**
 * In a browser the mark goes back to the landing page (one level up from /app,
 * secret prefix or not); inside a chat host there is no landing page to go to.
 */
export function DeskHeader({ standalone, children, center, actions }: { standalone: boolean; children?: ReactNode; center?: ReactNode; actions?: ReactNode }) {
  const brand = (
    <>
      <CartographLogo size={28} />
      <span className="font-serif text-[24px] leading-none tracking-tight text-text max-sm:hidden">Cartograph</span>
    </>
  );
  return (
    <header className="relative z-30 flex h-[56px] shrink-0 items-center gap-3 border-b border-text bg-bg px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        {standalone ? (
          <a href="./" className="flex items-center gap-2.5" title="Cartograph home">
            {brand}
          </a>
        ) : (
          <span className="flex items-center gap-2.5">{brand}</span>
        )}
        {children}
      </div>
      {center ? <div className="mx-auto">{center}</div> : <div className="flex-1" />}
      <div className="flex items-center gap-1.5">{actions}</div>
    </header>
  );
}

export function DeskFooter() {
  return (
    <footer className="mt-auto shrink-0 border-t border-line">
      <div className="mx-auto flex w-full max-w-[880px] flex-wrap items-center justify-between gap-3 px-6 py-3.5 font-mono text-[10.5px] tracking-[0.12em] text-faint uppercase">
        <span>Cartograph · Open Agent Hackathon 2026 · Track 02</span>
        <span className="flex items-center gap-4">
          <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer" className="transition-colors hover:text-text">README</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-text">
            <GithubMark size={12} /> Source
          </a>
        </span>
      </div>
    </footer>
  );
}
