import type { Metadata } from "next";
import "./globals.css";
import { Sonner } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Traxly",
  description:
    "A lightweight project planning workspace for dependency-driven scheduling and LLM-ready exports.",
  icons: {
    icon: "/icon",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans">
        {children}
        <Sonner />
      </body>
    </html>
  );
}
