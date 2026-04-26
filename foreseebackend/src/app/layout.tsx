import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ForeSee Backend",
  description: "Backend API powered by Next.js and ready for Vercel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
