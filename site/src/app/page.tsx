import { Finale } from "@/components/Finale";
import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { Problem } from "@/components/Problem";
import { Product } from "@/components/Product";
import { Sponsors } from "@/components/Sponsors";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <Product />
        <Sponsors />
        <Finale />
      </main>
    </>
  );
}
