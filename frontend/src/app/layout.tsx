import type { Metadata } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Display font for headings: a grotesk with some character, paired with Geist for body text.
const display = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Hachi · The loyal agent",
  description: "Hachi gets things done on websites for you, and keeps your logins, codes and keys safe.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: data-theme is set by the boot script before React loads.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="flex h-full min-h-full flex-col">{children}</body>
    </html>
  );
}
