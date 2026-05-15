import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "@/lib/query-provider";

export const metadata: Metadata = {
  title: "Aptos Translate",
  description: "POS/ERP-scale localization: streaming extractors, batch translation, dual-LLM QA.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full scroll-smooth antialiased">
      <body className="relative z-[1] flex min-h-dvh flex-col">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
