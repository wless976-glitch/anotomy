import type { Metadata, Viewport } from "next";
import { Forum, Onest } from "next/font/google";
import "./globals.css";

// Both families carry cyrillic-ext, which holds the Mongolian letters Ө and Ү.
const display = Forum({
  subsets: ["cyrillic", "cyrillic-ext", "latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const body = Onest({
  subsets: ["cyrillic", "cyrillic-ext", "latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Хүний бие 3D",
  description:
    "Хүний биеийг арьс, булчин, яс, дотор эрхтэн гэсэн давхаргаар нь 3D-ээр судлах интерактив атлас. Анагаах ухаан, сувилахуй, нүүр ам судлал, эм зүйн оюутнуудад.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="mn" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
