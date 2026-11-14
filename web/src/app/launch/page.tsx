import type { Metadata } from "next";
import LaunchClient from "./LaunchClient";

export const metadata: Metadata = { title: "UNO Reverse launches" };

export default function LaunchPage() {
  return <LaunchClient />;
}
