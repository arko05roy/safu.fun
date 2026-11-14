import { Hero } from "@/components/landing/Hero";
import { FinalCta, HowItWorks, OddsLab, Rails, Rules, StatsStrip, Trust, Underwriters, UnoReverse, WallPreview } from "@/components/landing/Sections";

export default function Home() {
  return (
    <>
      <Hero />
      <StatsStrip />
      <HowItWorks />
      <Rules />
      <OddsLab />
      <Rails />
      <UnoReverse />
      <Underwriters />
      <WallPreview />
      <Trust />
      <FinalCta />
    </>
  );
}
