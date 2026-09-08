import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pixelware - Complexity under control",
  description:
    "Backend and systems software engineer in Amsterdam. Distributed systems, reliability, and performance with TypeScript, Node.js, C++23, and Go. Explore production work, Radish, and engineering experience.",
  icons: {
    icon: "/favicon.svg?v=pixelware",
    shortcut: "/favicon.svg?v=pixelware",
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
