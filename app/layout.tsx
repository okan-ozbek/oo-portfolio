import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Okan Can Özbek — Backend & Systems Software Engineer",
  description:
    "Backend and systems software engineer in Amsterdam. Distributed systems, reliability, and performance with TypeScript, Node.js, C++23, and Go. Explore production work, Radish, and engineering experience.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
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
