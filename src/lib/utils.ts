import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combine conditional classes and resolve conflicting Tailwind utilities.
 * Input: conditional class values. Output: one consistent class string.
 * Use case: shared shadcn components with application-specific sizing.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
