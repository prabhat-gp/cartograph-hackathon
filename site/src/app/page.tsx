import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { HowItWorks } from "@/components/HowItWorks";
import { Sponsors } from "@/components/Sponsors";
import { Why } from "@/components/Why";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Why />
        <HowItWorks />
        <Sponsors />
      </main>
      <Footer />
    </>
  );
}
