import { MAP_RUN } from "@/lib/site";
import { PlateLabel } from "./Mark";

const stations = [
  {
    name: "Map",
    line: "Paste a repository. The survey party draws its architecture.",
    crew: [
      ["Scout", "Reads the tree and manifests, names the components and divides the ground."],
      ["Readers", `Read the code in parallel (${MAP_RUN.readers} on our test repo) and cite the line behind every road.`],
      ["Cartographer", "Joins it all into one map: components, roads and the routes requests take."],
      ["Verifier", "Checks every citation against the code. No line, no road."],
    ],
  },
  {
    name: "Explain",
    line: "Pick a road. A second party finds out why it was built.",
    crew: [
      ["Planner", "Turns the question into a target: some lines, a file or a topic."],
      ["Investigator", "Walks line → commit → pull request → issue through the data layer."],
      ["Writer & Critic", "One writes the answer with citations; the other checks every claim and sends weak ones back."],
      ["Memory", "Keeps each approved finding with its sources, and retires it when the code moves on."],
    ],
  },
  {
    name: "Watch",
    line: "Every push is checked against the map.",
    crew: [["Reviewer", "Flags layering breaks, new third-party calls and bypassed services within minutes of a push."]],
  },
];

const rules = [
  ["No citation, no road", "A dependency without a real line of code behind it never reaches the map."],
  ["The Critic signs off", "An answer ships only when every claim is backed by the evidence it cites."],
  ["Memory keeps its sources", "Remembered findings carry their commits and pull requests, and are superseded once the code changes."],
];

export function PlateSurvey() {
  return (
    <section id="survey" className="grain scroll-mt-14 border-t border-ink py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <PlateLabel plate="II" title="How it works" />
            <h2 className="mt-6 font-serif text-5xl leading-[1.02] sm:text-6xl">
              A survey party
              <br />
              <em className="text-vermilion">for your code.</em>
            </h2>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-soft">
              Specialist agents with one job each, working the same ground in three stages. Each one leaves a trace you can
              read.
            </p>
          </div>

          <ol className="relative">
            <span className="absolute top-3 bottom-3 left-[15px] border-l-2 border-dashed border-vermilion/50" aria-hidden="true" />
            {stations.map((s, i) => (
              <li key={s.name} className="relative pb-14 pl-14 last:pb-0">
                <span className="absolute top-0 left-0 grid size-8 place-items-center rounded-full border-2 border-vermilion bg-paper font-mono text-xs font-medium text-vermilion">
                  {i + 1}
                </span>
                <h3 className="font-serif text-4xl leading-none">{s.name}</h3>
                <p className="mt-2 text-ink-soft">{s.line}</p>
                <dl className="mt-6 divide-y divide-rule border-y border-rule">
                  {s.crew.map(([name, job]) => (
                    <div key={name} className="grid gap-1 py-3.5 sm:grid-cols-[150px_1fr] sm:gap-6">
                      <dt className="font-mono text-[12px] font-medium tracking-[0.12em] uppercase">{name}</dt>
                      <dd className="text-[15px] leading-relaxed text-ink-soft">{job}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-20 border border-ink bg-ink text-paper">
          <p className="border-b border-paper/20 px-6 py-3 font-mono text-[11px] tracking-[0.22em] uppercase">Rules of the survey</p>
          <div className="grid md:grid-cols-3">
            {rules.map(([title, text], i) => (
              <div key={title} className="border-paper/20 p-6 md:border-l md:first:border-l-0">
                <span className="font-serif text-3xl text-vermilion italic">{["i", "ii", "iii"][i]}.</span>
                <p className="mt-2 text-lg font-medium">{title}</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-paper/70">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
