import { NextResponse } from "next/server";
import { authErrorResponse, getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    return NextResponse.json({ user });
  } catch (error) {
    return authErrorResponse(error);
  }
}
