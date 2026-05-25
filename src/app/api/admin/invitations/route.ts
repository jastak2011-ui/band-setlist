import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { newId } from "@/lib/ids";

const inviteBody = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
  bandIds: z.array(z.string()).default([]),
});

function inviteBaseUrl(req: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

function invitationStatus(row: { accepted_at: Date | null; expires_at: Date }) {
  if (row.accepted_at) return "accepted";
  if (new Date(row.expires_at).getTime() < Date.now()) return "expired";
  return "pending";
}

async function loadInvitations(req: Request) {
  const result = await query(`
    SELECT
      i.*,
      inviter.email AS invited_by_email,
      COALESCE(
        json_agg(json_build_object('id', b.id, 'name', b.name) ORDER BY lower(b.name))
          FILTER (WHERE b.id IS NOT NULL),
        '[]'::json
      ) AS bands
    FROM invitations i
    LEFT JOIN app_users inviter ON inviter.id = i.invited_by
    LEFT JOIN invitation_bands ib ON ib.invitation_id = i.id
    LEFT JOIN bands b ON b.id = ib.band_id
    GROUP BY i.id, inviter.email
    ORDER BY i.created_at DESC
  `);
  const baseUrl = inviteBaseUrl(req);
  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by,
    invitedByEmail: row.invited_by_email,
    token: row.token,
    inviteUrl: `${baseUrl}/invite/${row.token}`,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    status: invitationStatus({ accepted_at: row.accepted_at as Date | null, expires_at: row.expires_at as Date }),
    bands: Array.isArray(row.bands) ? row.bands : [],
  }));
}

export async function GET(req: Request) {
  try {
    await requireAdmin();
    return NextResponse.json({ invitations: await loadInvitations(req) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = inviteBody.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    if (parsed.data.role === "member" && parsed.data.bandIds.length === 0) {
      return NextResponse.json({ error: "Choose at least one band for a member invite." }, { status: 400 });
    }

    const invitationId = newId();
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
    await transaction(async (client) => {
      await client.query(
        `
        INSERT INTO invitations (id, email, role, invited_by, token, expires_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `,
        [invitationId, parsed.data.email.trim().toLowerCase(), parsed.data.role, admin.id, token, expiresAt],
      );
      for (const bandId of parsed.data.bandIds) {
        await client.query(
          "INSERT INTO invitation_bands (invitation_id, band_id, created_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING",
          [invitationId, bandId],
        );
      }
    });

    const inviteUrl = `${inviteBaseUrl(req)}/invite/${token}`;
    return NextResponse.json({ id: invitationId, inviteUrl, invitations: await loadInvitations(req) }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const parsed = z.object({ id: z.string().min(1) }).safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
    const result = await query(
      "UPDATE invitations SET token = $2, expires_at = $3, accepted_at = NULL WHERE id = $1 RETURNING id",
      [parsed.data.id, token, expiresAt],
    );
    if (!result.rows[0]) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
    return NextResponse.json({ inviteUrl: `${inviteBaseUrl(req)}/invite/${token}`, invitations: await loadInvitations(req) });
  } catch (error) {
    return authErrorResponse(error);
  }
}
