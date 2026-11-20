import express from "express";
import { loadCart, redeem } from "./cart";

const router = express.Router();
router.get("/api/cart", loadCart);
router.post("/api/cart/voucher", redeem);
export default router;
