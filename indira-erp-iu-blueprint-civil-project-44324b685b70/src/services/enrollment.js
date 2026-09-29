import { supabase } from '../lib/supabaseClient.js';

// The Supabase JS SDK wraps non-2xx Edge Function responses in a FunctionsHttpError. The useful
// server-side message is inside error.context (a Response). Without extracting it, callers get
// the generic "Edge Function returned a non-2xx status code" — which is how BUG-02 slipped through.
async function extractEdgeError(error) {
  const status = error?.context?.status;
  let body = null;
  try {
    if (error?.context && typeof error.context.json === 'function') {
      body = await error.context.clone().json();
    }
  } catch { /* fall through — body may not be JSON */ }
  const serverMsg = body?.error || body?.message || null;
  return { status, serverMsg };
}

export async function enrollUmsEmployee(umsEmployee) {
  const { data, error } = await supabase.functions.invoke('enroll-user', {
    body: { umsEmployee },
  });
  if (error) {
    const { status, serverMsg } = await extractEdgeError(error);
    if (status === 409) throw new Error(serverMsg || 'This user is already enrolled.');
    if (status === 403) throw new Error(serverMsg || 'Only Project Admins can enroll users.');
    throw new Error(serverMsg || error.message || 'Enrollment failed.');
  }
  return data?.profile ?? null;
}

export async function enrollManualUser(manualUser) {
  const { data, error } = await supabase.functions.invoke('enroll-user', {
    body: { manualUser },
  });
  if (error) {
    const { status, serverMsg } = await extractEdgeError(error);
    if (status === 409) throw new Error(serverMsg || 'A user with this email is already enrolled.');
    if (status === 403) throw new Error(serverMsg || 'Only Project Admins can enroll users.');
    throw new Error(serverMsg || error.message || 'Enrollment failed.');
  }
  return data?.profile ?? null;
}
