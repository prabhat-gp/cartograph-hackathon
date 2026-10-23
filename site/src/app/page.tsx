import { Colophon } from "@/components/Colophon";
import { Header } from "@/components/Header";
import { PlateInstruments } from "@/components/PlateInstruments";
import { PlateSurvey } from "@/components/PlateSurvey";
import { PlateWhy } from "@/components/PlateWhy";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <PlateWhy />
        <PlateSurvey />
        <PlateInstruments />
      </main>
      <Colophon />
    </>
  );
}
