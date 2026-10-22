import { mapRepository } from "./map";
import { reviewChanges } from "./review";
import { traceQuestion } from "./trace";
import type { Brain } from "./types";

export { mapRepository, reviewChanges, traceQuestion };
export const brain: Brain = { mapRepository, reviewChanges, traceQuestion };
