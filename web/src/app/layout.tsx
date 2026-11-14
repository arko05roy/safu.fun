import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono, Silkscreen } from "next/font/google";
import { Footer, Nav, SmoothScroll } from "@/components/chrome";
import { WalletProvider } from "@/components/wallet";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });
const pixel = Silkscreen({ variable: "--font-silkscreen", subsets: ["latin"], weight: ["400", "700"] });

export const metadata: Metadata = {
  title: { default: "safu.fun — rug cover for any memecoin, any chain", template: "%s · safu.fun" },
  description: "Buy any memecoin on any chain. If it rugs, you get paid back — on any chain you want. Built on NEAR Intents and Chain Signatures.",
  openGraph: {
    title: "safu.fun — the rug got rugged",
    description: "Rug cover for any memecoin on any chain, paid out wherever you want by a NEAR contract.",
  },
};

export const viewport: Viewport = { themeColor: "#0a0a0a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${mono.variable} ${pixel.variable} antialiased`}>
      <body className="min-h-dvh overflow-x-clip">
        <WalletProvider>
          <SmoothScroll />
          <Nav />
          <main className="relative">{children}</main>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  );
}
