import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Music Distribution",
  description: "Music Distribution platform",
};

/**
 * Description: Render the document shell of every page.
 * Input: The page content.
 * Output: <html lang="en"> and <body> with the base theme tokens.
 * Use case: Next.js root layout.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
