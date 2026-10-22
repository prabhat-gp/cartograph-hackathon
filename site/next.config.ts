import type { NextConfig } from "next";

// Exported as static files: the Cartograph server serves them at "/", next to
// the map desk at "/app", so the whole product lives on one address.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
