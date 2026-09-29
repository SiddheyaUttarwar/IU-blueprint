import { getGraphToken } from './graphAuth.ts';

export async function sendMail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const from = Deno.env.get('MAIL_FROM_ADDRESS');
  if (!from) throw new Error('Missing MAIL_FROM_ADDRESS');

  const token = await getGraphToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: opts.subject,
          body: { contentType: 'HTML', content: opts.html },
          toRecipients: [{ emailAddress: { address: opts.to } }],
        },
        saveToSentItems: true,
      }),
    },
  );
  if (!res.ok) throw new Error(`Graph sendMail ${res.status}: ${await res.text()}`);
}
