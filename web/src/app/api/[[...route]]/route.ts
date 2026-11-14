import { handle } from "hono/vercel";
import { app } from "@/server/api/app";

// The whole safu API (src/server/api) served by Next.js at /api/*.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = handle(app);
export { handler as GET, handler as POST, handler as OPTIONS };
