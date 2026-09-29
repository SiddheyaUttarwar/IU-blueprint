import { corsHeaders } from '../_shared/cors.ts';
import { requireAdminCaller } from '../_shared/supabaseAdmin.ts';
import { getGraphToken } from '../_shared/graphAuth.ts';

// Fields we ask Microsoft Graph to return. Kept minimal so we don't leak
// unnecessary directory data to the client.
const SELECT_FIELDS = [
  'id', 'displayName', 'givenName', 'surname', 'mail', 'userPrincipalName',
  'jobTitle', 'department', 'mobilePhone', 'officeLocation', 'accountEnabled',
].join(',');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    await requireAdminCaller(req.headers.get('authorization'));
    const body = await req.json().catch(() => ({}));
    const raw = String(body?.query ?? '').trim();
    if (raw.length < 2) {
      return new Response(JSON.stringify({ users: [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = await getGraphToken();
    // $search requires ConsistencyLevel: eventual. Search across displayName + mail + UPN.
    // Escape any embedded double-quotes to prevent OData injection.
    const escaped = raw.replaceAll('"', '\\"');
    const searchExpr = `"displayName:${escaped}" OR "mail:${escaped}" OR "userPrincipalName:${escaped}"`;
    const url = `https://graph.microsoft.com/v1.0/users`
      + `?$search=${encodeURIComponent(searchExpr)}`
      + `&$select=${SELECT_FIELDS}`
      + `&$top=25`
      + `&$orderby=displayName`;

    const gRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ConsistencyLevel: 'eventual',
      },
    });
    if (!gRes.ok) {
      const detail = await gRes.text();
      throw new Error(`Graph search failed ${gRes.status}: ${detail}`);
    }
    const gJson = await gRes.json();
    const users = (gJson.value ?? [])
      .filter((u: { accountEnabled?: boolean }) => u.accountEnabled !== false)
      .map((u: Record<string, unknown>) => ({
        id: u.id,
        displayName: u.displayName ?? null,
        givenName: u.givenName ?? null,
        surname: u.surname ?? null,
        mail: u.mail ?? u.userPrincipalName ?? null,
        userPrincipalName: u.userPrincipalName ?? null,
        jobTitle: u.jobTitle ?? null,
        department: u.department ?? null,
        mobilePhone: u.mobilePhone ?? null,
        officeLocation: u.officeLocation ?? null,
      }));

    return new Response(JSON.stringify({ users }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === 'unauthenticated' ? 401 : msg === 'forbidden' ? 403 : 400;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
