import type { Item } from "../api/cart";

export function CartItem({ item }: { item: Item }) {
  return <li>{item.name}</li>;
}
