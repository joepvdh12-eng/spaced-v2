// SPACED v2 — Stripe Checkout
// Netlify Function: /.netlify/functions/create-checkout-session

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

  const { priceId, billingPeriod } = JSON.parse(event.body || '{}');

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    // Build session options
    const sessionOptions = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email,
      client_reference_id: user.id,
      success_url: `${process.env.URL}/app/dashboard.html?subscribed=1`,
      cancel_url: `${process.env.URL}/app/dashboard.html?cancelled=1`,
      metadata: { user_id: user.id },
      subscription_data: {
        metadata: { user_id: user.id },
      },
    };

    // Apply 50% off first month coupon for monthly plan
    // STRIPE_FIRST_MONTH_COUPON: create a coupon in Stripe dashboard:
    //   - 50% off, once (applies only to first invoice)
    //   - Add the coupon ID to your Netlify env vars as STRIPE_FIRST_MONTH_COUPON
    if (billingPeriod === 'monthly' && process.env.STRIPE_FIRST_MONTH_COUPON) {
      sessionOptions.discounts = [{ coupon: process.env.STRIPE_FIRST_MONTH_COUPON }];
    }

    const session = await stripe.checkout.sessions.create(sessionOptions);

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error('Stripe error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
