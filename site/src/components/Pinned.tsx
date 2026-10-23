"use client";

import { type MotionValue, useMotionValueEvent, useScroll } from "motion/react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

/**
 * A tall section whose inner frame sticks to the screen while you scroll
 * through it: scroll position becomes the current step.
 */
export function usePinnedStep(ref: RefObject<HTMLElement | null>, count: number): { step: number; progress: MotionValue<number> } {
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [step, setStep] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (p) => setStep(Math.min(count - 1, Math.max(0, Math.floor(p * count)))));
  return { step, progress: scrollYProgress };
}

/** Scrolls the page so a pinned section lands on a given step. */
export function scrollToStep(section: HTMLElement | null, step: number, count: number) {
  if (!section) return;
  const top = section.getBoundingClientRect().top + scrollY;
  const travel = section.offsetHeight - innerHeight;
  scrollTo({ top: top + (travel * (step + 0.5)) / count, behavior: "smooth" });
}

/** Renders its children only once they scroll into view, so their entrance animation plays where it's seen. */
export function WhenSeen({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={className}>
      {seen ? children : null}
    </div>
  );
}
