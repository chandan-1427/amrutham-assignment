import { signWebhookPayload } from '../lib/payment-gateway.js';

async function simulate() {
  const [providerRef, consultationId, status] = process.argv.slice(2);
  if (!providerRef || !consultationId || !status) {
    console.error('Usage: pnpm webhook:simulate <providerRef> <consultationId> <confirmed|failed>');
    process.exit(1);
  }

  const body = JSON.stringify({ providerRef, consultationId, status });
  const signature = signWebhookPayload(body);

  const res = await fetch('http://localhost:3000/payments/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': signature },
    body,
  });

  console.log(res.status, await res.json());
}

simulate();