import { useEffect, useState } from "react";
import { getCart, type Item } from "../api/cart";

export function useCart() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    void getCart().then(setItems);
  }, []);
  return { items };
}
