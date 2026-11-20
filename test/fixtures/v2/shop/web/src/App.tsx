import { BrowserRouter, Route, Routes } from "react-router-dom";
import CartPage from "./pages/CartPage";
import { OrderPage } from "./pages/OrderPage";

function Home() {
  return <h1>Shop</h1>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/orders/:id" element={<OrderPage />} />
      </Routes>
    </BrowserRouter>
  );
}
