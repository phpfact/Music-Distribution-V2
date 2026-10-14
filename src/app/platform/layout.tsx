import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Platform | Music Distribution",
  robots: { index: false, follow: false },
};

export default function PlatformLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
