import { supabase } from '../lib/supabaseClient.js';

// Searches the org's Microsoft Entra directory via the search-entra edge function.
// Returns [] for queries shorter than 2 characters (server also short-circuits).
export async function searchEntraDirectory(query) {
  const q = (query ?? '').trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.functions.invoke('search-entra', { body: { query: q } });
  if (error) {
    const status = error?.context?.status;
    // Try to lift the server's error body up into the message so the toast is actionable.
    let serverMsg = '';
    try { serverMsg = (await error.context?.json?.())?.error ?? ''; } catch { /* ignore */ }
    if (status === 403) throw new Error('Only Project Admins can search the directory.');
    if (status === 401) throw new Error('You need to sign in again.');
    if (status === 404 || /Failed to send/i.test(error.message ?? '')) {
      throw new Error('The search-entra edge function is not deployed. Run `supabase functions deploy search-entra` and try again.');
    }
    if (serverMsg.includes('Missing AZURE_')) {
      throw new Error('Server is missing Azure credentials. Set AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET in Supabase secrets.');
    }
    if (serverMsg.includes('Authorization_RequestDenied') || serverMsg.includes('Insufficient privileges')) {
      throw new Error('The Azure app is missing the User.Read.All permission (admin consent required).');
    }
    throw new Error(serverMsg || error.message || 'Directory search failed.');
  }
  return data?.users ?? [];
}
