import type { Metadata } from "next";
import { Bricolage_Grotesque, Martian_Mono, Schibsted_Grotesk } from "next/font/google";
import { Masthead } from "@/components/Masthead";
import "./globals.css";

const display = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], weight: "variable" });
const body = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"], weight: "variable" });
const figure = Martian_Mono({ variable: "--font-martian", subsets: ["latin"], weight: "variable" });

export const metadata: Metadata = {
  title: "Exit Window: copy the exit, not the entry",
  description:
    "How long you had after a Hyperliquid wallet started exiting, what copying it cost at your delay, and a live follow that mirrors its reduces. Built on the Nansen API.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${figure.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <Masthead />
        {children}
      </body>
    </html>
  );
}
