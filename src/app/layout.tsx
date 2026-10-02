import type { Metadata } from "next";
import { IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif" });

export const metadata: Metadata = { title: "Contract Analyst", description: "Ask questions about contracts. Every answer is quoted and verified." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex h-14 max-w-6xl items-center px-4">
            <a href="/" className="text-[15px] font-semibold tracking-tight">Contract Analyst</a>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
