// SPACED v2 — Stripe Webhook Handler
// Netlify Function: /.netlify/functions/stripe-webhook
//
// Handles: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
// Updates user subscription status in Supabase

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Verify Stripe signature
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      event.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  console.log('Stripe webhook received:', stripeEvent.type);

  try {
    switch (stripeEvent.type) {

      // New subscription created via checkout
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const userId = session.metadata?.user_id || session.client_reference_id;
        if (!userId) break;

        const subscriptionId = session.subscription;
        if (!subscriptionId) break;

        // Fetch subscription details from Stripe
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price?.id;
        const currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
        const billingInterval = subscription.items.data[0]?.price?.recurring?.interval; // 'month' or 'year'

        await sb.from('user_subscriptions').upsert({
          user_id: userId,
          stripe_customer_id: session.customer,
          stripe_subscription_id: subscriptionId,
          stripe_price_id: priceId,
          status: 'active',
          billing_interval: billingInterval,
          current_period_end: currentPeriodEnd,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

        console.log(`Subscription activated for user ${userId}`);
        break;
      }

      // Subscription renewed or changed
      case 'customer.subscription.updated': {
        const subscription = stripeEvent.data.object;
        const userId = subscription.metadata?.user_id;
        if (!userId) break;

        const priceId = subscription.items.data[0]?.price?.id;
        const currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
        const billingInterval = subscription.items.data[0]?.price?.recurring?.interval;

        // Map Stripe status to our status
        const statusMap = {
          'active': 'active',
          'past_due': 'past_due',
          'canceled': 'canceled',
          'unpaid': 'past_due',
          'trialing': 'active',
        };
        const status = statusMap[subscription.status] || subscription.status;

        await sb.from('user_subscriptions').upsert({
          user_id: userId,
          stripe_subscription_id: subscription.id,
          stripe_price_id: priceId,
          status,
          billing_interval: billingInterval,
          current_period_end: currentPeriodEnd,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

        console.log(`Subscription updated for user ${userId}: ${status}`);
        break;
      }

      // Subscription cancelled
      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object;
        const userId = subscription.metadata?.user_id;
        if (!userId) break;

        await sb.from('user_subscriptions').upsert({
          user_id: userId,
          stripe_subscription_id: subscription.id,
          status: 'canceled',
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

        console.log(`Subscription cancelled for user ${userId}`);
        break;
      }

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }
  } catch (err) {
    console.error('Error processing webhook:', err);
    return { statusCode: 500, body: 'Internal error processing webhook' };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
