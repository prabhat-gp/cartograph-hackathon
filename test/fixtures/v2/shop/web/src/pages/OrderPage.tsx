import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export function OrderPage() {
  const { id } = useParams();
  const [order, setOrder] = useState<{ total: number } | null>(null);
  useEffect(() => {
    fetch(`/api/orders/${id}`).then((r) => r.json()).then(setOrder);
  }, [id]);
  return <section>{order ? order.total : "Loading…"}</section>;
}
