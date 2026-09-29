import { corsHeaders } from '../_shared/cors.ts';
import { adminClient, requireAdminCaller } from '../_shared/supabaseAdmin.ts';

const ALLOWED_ROLES = ['project_admin', 'project_manager', 'it_admin', 'leadership', 'member'];

function toProfileRow(ums: Record<string, unknown>, enrolledBy: string) {
  return {
    email: String(ums.emailId).toLowerCase(),
    first_name: ums.firstName ?? null,
    middle_name: ums.middleName ?? null,
    last_name: ums.lastName ?? null,
    emp_id: ums.empId ?? null,
    title_id: ums.titleId ?? null,
    designation_id: ums.designationId ?? null,
    staff_type_id: ums.staffTypeId ?? null,
    indira_university_id: ums.indiraUniversityId ?? null,
    employee_number: ums.employeeNumber ?? null,
    mobile_number: ums.mobileNumber ?? null,
    emergency_contact_number: ums.emergencyContactNumber ?? null,
    date_of_birth: ums.dateOfBirth ?? null,
    organisation_joining_date: ums.organisationJoiningDate ?? null,
    gender: ums.gender ?? null,
    blood_group: ums.bloodGroup ?? null,
    source: 'manual',
    must_change_password: true,
    enrolled_by: enrolledBy,
  };
}

function toManualProfileRow(m: Record<string, unknown>, enrolledBy: string) {
  const rawRoles = Array.isArray(m.roles) ? m.roles as string[] : [];
  const roles = [...new Set(rawRoles.filter((r) => ALLOWED_ROLES.includes(r)))];
  if (roles.length === 0) roles.push('member');
  const primary = roles.includes('project_admin')
    ? 'project_admin'
    : roles.includes('it_admin')
      ? 'it_admin'
      : roles[0];
  return {
    email: String(m.email).toLowerCase(),
    first_name: m.firstName ?? null,
    middle_name: m.middleName ?? null,
    last_name: m.lastName ?? null,
    mobile_number: m.mobileNumber ?? null,
    role: primary,
    roles,
    source: 'manual',
    must_change_password: true,
    enrolled_by: enrolledBy,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { profile: caller } = await requireAdminCaller(req.headers.get('authorization'));
    const body = await req.json();
    const umsEmployee = body?.umsEmployee ?? null;
    const manualUser = body?.manualUser ?? null;
    if (!umsEmployee && !manualUser) throw new Error('umsEmployee or manualUser required');
    if (umsEmployee && !umsEmployee.emailId) throw new Error('umsEmployee.emailId required');
    if (manualUser && !manualUser.email) throw new Error('manualUser.email required');

    const admin = adminClient();
    const email = String(umsEmployee ? umsEmployee.emailId : manualUser.email).toLowerCase();

    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ error: 'already_enrolled' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const appUrl = Deno.env.get('APP_URL') ?? '';
    const redirectTo = `${appUrl.replace(/\/$/, '')}/set-password`;

    const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
    });
    if (inviteErr || !inviteData?.user) throw inviteErr ?? new Error('inviteUserByEmail failed');

    const row = umsEmployee
      ? { ...toProfileRow(umsEmployee, caller.id), auth_user_id: inviteData.user.id }
      : { ...toManualProfileRow(manualUser, caller.id), auth_user_id: inviteData.user.id };
    const { data: profile, error: insErr } = await admin
      .from('profiles')
      .insert(row)
      .select()
      .single();
    if (insErr) {
      await admin.auth.admin.deleteUser(inviteData.user.id);
      throw insErr;
    }

    return new Response(JSON.stringify({ profile }), {
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
