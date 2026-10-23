// Which brain to use. CARTOGRAPH_BRAIN=fixture swaps in a hand-written, offline brain
// for UI development and tests (no API calls, chai-commerce only).
import { brain as agents } from "./brain";
import type { Brain } from "./brain/types";

let fixture: Brain | undefined;

export async function getBrain(): Promise<Brain> {
  if (process.env.CARTOGRAPH_BRAIN !== "fixture") return agents;
  fixture ??= (await import("../../test/fixtures/fixture-brain")).fixtureBrain;
  return fixture;
}
