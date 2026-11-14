import type { Metadata } from "next";
import { Suspense } from "react";
import BuyClient from "./BuyClient";

export const metadata: Metadata = { title: "Buy cover" };

export default function BuyPage() {
  return (
    <Suspense>
      <BuyClient />
    </Suspense>
  );
}
