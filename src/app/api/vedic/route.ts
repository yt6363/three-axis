import { NextResponse } from "next/server";
import { computeSwissEphemeris, type SwissRequest } from "@/lib/vedic-swiss";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as Partial<SwissRequest>;
    const lat = Number(payload.lat);
    const lon = Number(payload.lon);
    const ascHours = Number(payload.ascHours);
    const moonDays = Number(payload.moonDays);
    const tz = payload.tz;
    const startLocalISO = payload.startLocalISO;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ ok: false, error: "invalid lat/lon" }, { status: 400 });
    }
    if (typeof tz !== "string" || !tz) {
      return NextResponse.json({ ok: false, error: "invalid timezone" }, { status: 400 });
    }
    if (typeof startLocalISO !== "string" || !startLocalISO) {
      return NextResponse.json({ ok: false, error: "invalid start datetime" }, { status: 400 });
    }
    if (!Number.isFinite(ascHours) || !Number.isFinite(moonDays)) {
      return NextResponse.json({ ok: false, error: "invalid horizons" }, { status: 400 });
    }

    const result = computeSwissEphemeris({
      lat,
      lon,
      tz,
      startLocalISO,
      ascHours,
      moonDays,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    const message = err?.message ?? "Swiss computation failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
