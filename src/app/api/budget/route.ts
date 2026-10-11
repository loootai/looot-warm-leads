import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/auth/guard";
import { budgetStatus, makeCtx, setBudget } from "@/server/service";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Admin. Reads the period budget: limits, used, reserved and remaining for today and this month. */
export async function GET(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  return NextResponse.json(await budgetStatus(await makeCtx()), { headers: NO_STORE });
}

/**
 * Admin. The owner changes the daily and monthly budget in dollars. Needs the session and the CSRF token.
 * This is the only way to change it. A paid run cannot carry a budget.
 */
export async function PUT(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  const body = (await req.json().catch(() => ({}))) as { dailyUsd?: unknown; monthlyUsd?: unknown };
  try {
    return NextResponse.json(await setBudget(await makeCtx(), { dailyUsd: body.dailyUsd, monthlyUsd: body.monthlyUsd }), { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400, headers: NO_STORE });
  }
}
