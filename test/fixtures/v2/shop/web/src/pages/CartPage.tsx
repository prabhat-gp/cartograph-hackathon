import { useCart } from "../hooks/useCart";
import { CartItem } from "../components/CartItem";
import VoucherForm from "../components/VoucherForm";

// Don't break on apostrophes in JSX text.
export default function CartPage() {
  const { items } = useCart();
  return (
    <main>
      <p>Don't miss our deals: {items.length} items</p>
      {items.map((item) => (
        <CartItem key={item.id} item={item} />
      ))}
      <VoucherForm />
    </main>
  );
}
