export async function loadCart(_req: unknown, res: { json(v: unknown): void }) {
  res.json([]);
}

export async function redeem(_req: unknown, res: { json(v: unknown): void }) {
  res.json({ ok: true });
}
