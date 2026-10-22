import { BookOpenText, Brain, Compass, GitCompareArrows, Network, Route, ScanSearch, ShieldCheck, Workflow } from "lucide-react";
import { MAP_RUN } from "@/lib/site";

const steps = [
  {
    n: "01",
    title: "Map",
    lede: "Paste a repository. Agents draw its architecture.",
    agents: [
      { icon: Compass, name: "Scout", text: "Reads the tree and manifests, proposes the components and splits the work." },
      { icon: BookOpenText, name: "Readers", text: `Read the code in parallel (${MAP_RUN.readers} on our test repo) and cite each dependency's line.` },
      { icon: Network, name: "Cartographer", text: "Assembles components, dependencies and request flows." },
      { icon: ShieldCheck, name: "Verifier", text: "Checks every citation against the code and drops what it can't find." },
    ],
  },
  {
    n: "02",
    title: "Explain",
    lede: "Click any arrow. Agents find out why it exists.",
    agents: [
      { icon: Route, name: "Planner", text: "Turns the question into a target: lines, a file or a topic." },
      { icon: ScanSearch, name: "Investigator", text: "Walks line → commit → pull request → issue through the data layer." },
      { icon: Workflow, name: "Writer + Critic", text: "One drafts with citations; the other checks every claim and sends weak ones back." },
      { icon: Brain, name: "Memory", text: "Keeps approved findings with their sources, and sets them aside when the code changes." },
    ],
  },
  {
    n: "03",
    title: "Watch",
    lede: "Every push is reviewed against the map.",
    agents: [
      { icon: GitCompareArrows, name: "Reviewer", text: "Flags layering violations, new third-party calls and bypassed services within minutes of a push." },
    ],
  },
];

const guarantees = [
  { title: "No citation, no arrow", text: "A dependency without a real line of code behind it never reaches the map." },
  { title: "The Critic signs off", text: "An answer ships only when every claim is backed by the evidence it cites." },
  { title: "Memory with sources", text: "Remembered findings carry their commits and PRs, and are superseded, not trusted, once the code moves." },
];

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-16 border-t border-black/5 bg-white py-24 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="font-mono text-xs font-medium tracking-[0.18em] text-brand-600 uppercase">What it does</p>
          <h2 className="mt-4 text-4xl leading-[1.08] font-semibold tracking-[-0.03em] sm:text-5xl">
            A map you can trust.
            <span className="block text-ink-soft">Answers you can check.</span>
          </h2>
        </div>

        <div className="mt-14 space-y-5">
          {steps.map((step) => (
            <div key={step.n} className="grid gap-6 rounded-3xl border border-black/5 bg-paper p-6 sm:p-8 lg:grid-cols-[260px_1fr]">
              <div>
                <span className="font-mono text-sm text-brand-600">{step.n}</span>
                <h3 className="mt-2 text-3xl font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{step.lede}</p>
              </div>
              <div className={`grid gap-3 ${step.agents.length > 1 ? "sm:grid-cols-2" : ""}`}>
                {step.agents.map(({ icon: Icon, name, text }) => (
                  <div key={name} className="flex gap-4 rounded-2xl border border-black/5 bg-white p-5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <p className="font-semibold">{name}</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-soft">{text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-px overflow-hidden rounded-3xl border border-black/5 bg-black/5 md:grid-cols-3">
          {guarantees.map((g) => (
            <div key={g.title} className="bg-night-900 p-6 text-white">
              <p className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="size-4 text-cited" /> {g.title}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{g.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
