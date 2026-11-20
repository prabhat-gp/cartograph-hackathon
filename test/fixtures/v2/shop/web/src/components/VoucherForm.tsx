import { useState } from "react";
import { applyVoucher } from "../api/cart";

const VoucherForm = () => {
  const [code, setCode] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); void applyVoucher(code); }}>
      <input value={code} onChange={(e) => setCode(e.target.value)} />
    </form>
  );
};

export default VoucherForm;
