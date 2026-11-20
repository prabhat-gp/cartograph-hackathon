import axios from "axios";

const API = import.meta.env.VITE_API ?? "";
export type Item = { id: string; name: string };

export async function getCart(): Promise<Item[]> {
  const res = await fetch(`${API}/api/cart`);
  return res.json();
}

export const applyVoucher = (code: string) => axios.post("/api/cart/voucher", { code });
