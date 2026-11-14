import type { Metadata } from "next";
import DemoClient from "./DemoClient";

export const metadata: Metadata = {
  title: "90-second demo",
  description: "Watch a real safu.fun testnet run end to end: cover bought, dev dumps, watcher reports, payouts land on two chains, UNO REVERSE refunds holders.",
};

export default function DemoPage() {
  return <DemoClient />;
}
