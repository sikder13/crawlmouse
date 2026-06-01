import 'server-only';
import Stripe from 'stripe';

// apiVersion omitted → uses the account default pinned by the SDK.
// If TS requires it, set it to the version in Stripe Dashboard → Developers → API version.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
