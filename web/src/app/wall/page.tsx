import type { Metadata } from "next";
import WallClient from "./WallClient";

export const metadata: Metadata = { title: "Wall of Rugs" };

export default function WallPage() {
  return <WallClient />;
}
