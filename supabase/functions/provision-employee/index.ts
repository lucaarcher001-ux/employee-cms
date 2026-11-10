import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ProvisionRequest {
  fullName?: unknown;
  email?: unknown;
  role?: unknown;
  baseSalaryPkr?: unknown;
  zkUserId?: unknown;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const authorization = request.headers.get("authorization") || "";
    const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return jsonResponse({ error: "Authentication required." }, 401);
    }

    const supabase = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: authData, error: authError } = await supabase.auth.getUser(
      tokenMatch[1],
    );
    if (authError || !authData.user) {
      return jsonResponse({
        error: "Your session is invalid or expired. Sign in again.",
      }, 401);
    }

    const { data: callerProfile, error: callerProfileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (callerProfileError) throw callerProfileError;
    if (!callerProfile || !["hr", "admin"].includes(callerProfile.role)) {
      return jsonResponse({ error: "HR/Admin access required." }, 403);
    }

    let body: ProvisionRequest;
    try {
      body = await request.json() as ProvisionRequest;
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }

    const fullName = typeof body.fullName === "string"
      ? body.fullName.trim()
      : "";
    const email = typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";
    const role = typeof body.role === "string" ? body.role : "";
    const zkUserId = typeof body.zkUserId === "string"
      ? body.zkUserId.trim()
      : "";
    const baseSalaryPkr = body.baseSalaryPkr;

    if (!fullName || fullName.length > 120) {
      return jsonResponse({
        error: "Full name must contain 1 to 120 characters.",
      }, 400);
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "Enter a valid email address." }, 400);
    }
    if (!["sales", "operations", "hr"].includes(role)) {
      return jsonResponse({ error: "Select a valid employee role." }, 400);
    }
    if (!/^\d+$/.test(zkUserId)) {
      return jsonResponse({ error: "Enter a numeric ZKBio employee ID." }, 400);
    }
    if (
      typeof baseSalaryPkr !== "number" ||
      !Number.isFinite(baseSalaryPkr) ||
      baseSalaryPkr < 0 ||
      baseSalaryPkr > 1_000_000_000
    ) {
      return jsonResponse(
        { error: "Enter a valid non-negative base salary." },
        400,
      );
    }

    const { data: existingProfile, error: duplicateError } = await supabase
      .from("profiles")
      .select("id")
      .eq("zk_user_id", zkUserId)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (existingProfile) {
      return jsonResponse({
        error: "That ZKBio employee ID is already assigned to another profile.",
      }, 409);
    }

    const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          full_name: fullName,
          role,
          zk_user_id: zkUserId,
          base_salary_pkr: baseSalaryPkr,
        },
      },
    );
    if (inviteError) {
      const alreadyExists = /already|registered|exists/i.test(
        inviteError.message,
      );
      return jsonResponse(
        {
          error: alreadyExists
            ? "An account already exists for that email address."
            : inviteError.message,
        },
        alreadyExists ? 409 : 400,
      );
    }

    return jsonResponse({ success: true }, 200);
  } catch (error) {
    console.error("Employee provisioning failed:", error);
    return jsonResponse({
      error:
        "Could not provision the employee account. Check the function logs.",
    }, 500);
  }
});
