// SPACED v2 — Stripe Billing Portal
// Netlify Function: /.netlify/functions/create-portal-session
// Lets an already-subscribed athlete manage or cancel their subscription in Stripe's
// own hosted portal — no custom cancellation UI/logic needed on our side.

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  const token = event.headers.authorization?.replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };

  const { data: sub } = await sb.from('user_subscriptions').select('stripe_customer_id').eq('user_id', user.id).single();
  if (!sub?.stripe_customer_id) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'No billing account found for this user yet.' }) };
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${process.env.URL}/app/settings.html`,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url: portalSession.url }) };
  } catch (err) {
    console.error('Stripe portal error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
