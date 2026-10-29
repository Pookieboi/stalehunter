import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif, Noto_Serif_Devanagari, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif", subsets: ["latin"] });
// Devanagari fallback so Hindi/Marathi articles render in a matching serif.
const devanagari = Noto_Serif_Devanagari({ variable: "--font-devanagari", subsets: ["devanagari"], weight: ["400", "600"] });
const display = Instrument_Serif({ variable: "--font-display", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "Stale Hunter",
  description:
    "Finds outdated facts in Wikipedia articles, checks them against the live web, and drafts sourced corrections. Powered by NVIDIA Nemotron on Nebius Token Factory.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} ${serif.variable} ${display.variable} ${devanagari.variable} antialiased`}>
        <div className="backdrop" />
        {children}
      </body>
    </html>
  );
}
