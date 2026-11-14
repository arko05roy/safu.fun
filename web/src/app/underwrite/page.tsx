import type { Metadata } from "next";
import UnderwriteClient from "./UnderwriteClient";

export const metadata: Metadata = { title: "Underwrite" };

export default function UnderwritePage() {
  return <UnderwriteClient />;
}
