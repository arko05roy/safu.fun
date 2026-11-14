import type { Metadata } from "next";
import CoverClient from "./CoverClient";

export const metadata: Metadata = { title: "Cover status" };

export default function CoverPage() {
  return <CoverClient />;
}
