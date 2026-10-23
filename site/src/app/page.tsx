import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { Problem } from "@/components/Problem";
import { Product } from "@/components/Product";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <Product />
      </main>
    </>
  );
}
