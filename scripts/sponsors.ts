// Live status of every sponsor integration, for setup checks and the demo.
//   npm run sponsors
import { checkSponsors } from "../src/server/status";

const rows = await checkSponsors();
for (const r of rows) console.log(`${r.status.toUpperCase().padEnd(8)} ${r.sponsor.padEnd(22)} ${r.detail}`);
process.exitCode = rows.some((r) => r.status === "fail") ? 1 : 0;
