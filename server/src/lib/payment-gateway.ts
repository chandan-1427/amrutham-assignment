import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env.js';

export function createPaymentIntent(amount: string, consultationId: string) {
  return {
    intentId: `pi_${randomUUID()}`,
    checkoutUrl: `https://stub-gateway.local/checkout/${consultationId}`,
  };
}

export function signWebhookPayload(rawBody: string): string {
  return createHmac('sha256', env.PAYMENT_GATEWAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const expected = Buffer.from(signWebhookPayload(rawBody), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}