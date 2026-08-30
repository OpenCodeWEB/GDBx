/**
 * gdmx-providers.js — Multi-provider on-ramp (MoonPay-like) — FAST, no single limitation
 * Parallel race + fallback + cache → fastest provider wins.
 */

export const PROVIDERS = [
  {
    id: "moonpay",
    name: "MoonPay",
    logo: "🌙",
    fee: "~1%",
    createCheckout: async ({ to, amount, env, origin }) => {
      const key = env.MOONPAY_API_KEY;
      if (!key) return null;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      try {
        const res = await fetch("https://api.moonpay.com/v1/transactions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Api-Key ${key}` },
          body: JSON.stringify({ walletAddress: to, baseCurrencyAmount: Number(amount), baseCurrencyCode: "usd", currencyCode: "usdc", redirectURL: `${origin}/success` }),
          signal: ctrl.signal,
        });
        const j = await res.json();
        if (j.widgetUrl || j.url) return { url: j.widgetUrl || j.url, provider: "moonpay", ms: Date.now() };
      } catch {}
      finally { clearTimeout(t); }
      return null;
    },
  },
  {
    id: "transak",
    name: "Transak",
    logo: "↗",
    fee: "~0.99%",
    createCheckout: async ({ to, amount, env }) => {
      const key = env.TRANSAK_API_KEY;
      if (!key) return null;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      try {
        const res = await fetch("https://api.transak.com/api/v2/partners/order", {
          method: "POST",
          headers: { "content-type": "application/json", "api-key": key },
          body: JSON.stringify({ walletAddress: to, fiatAmount: Number(amount), fiatCurrency: "USD", cryptoCurrency: "USDC" }),
          signal: ctrl.signal,
        });
        const j = await res.json();
        if (j.url || j.redirectUrl) return { url: j.url || j.redirectUrl, provider: "transak" };
      } catch {}
      finally { clearTimeout(t); }
      return null;
    },
  },
  {
    id: "ramp",
    name: "Ramp",
    logo: "▲",
    fee: "~0.49%",
    createCheckout: async ({ to, amount, env }) => {
      const key = env.RAMP_API_KEY;
      if (!key) return null;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      try {
        const res = await fetch("https://api.ramp.network/api/host-api/v3/onramp", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Api-Key ${key}` },
          body: JSON.stringify({ destinationAddress: to, fiatValue: Number(amount), fiatCurrency: "USD", cryptoCurrency: "USDC" }),
          signal: ctrl.signal,
        });
        const j = await res.json();
        if (j.url) return { url: j.url, provider: "ramp" };
      } catch {}
      finally { clearTimeout(t); }
      return null;
    },
  },
  {
    id: "coinbase",
    name: "Coinbase Pay",
    logo: "◈",
    fee: "~1%",
    createCheckout: async ({ to, amount, env }) => {
      const key = env.COINBASE_API_KEY;
      if (!key) return null;
      return null;
    },
  },
  {
    id: "stripe",
    name: "Stripe",
    logo: "💳",
    fee: "~2.9%",
    createCheckout: async ({ to, amount, env }) => {
      const key = env.STRIPE_SECRET_KEY;
      if (!key) return null;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      try {
        const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
          body: `success_url=${encodeURIComponent(`https://dsgx.pages.dev/success?to=${encodeURIComponent(to)}`)}&cancel_url=${encodeURIComponent(`https://dsgx.pages.dev/cancel`)}&mode=payment&line_items[0][price_data][currency]=usd&line_items[0][price_data][product_data][name]=Support+${encodeURIComponent(to)}&line_items[0][price_data][unit_amount]=${Math.round(Number(amount) * 100)}&line_items[0][quantity]=1`,
          signal: ctrl.signal,
        });
        const j = await res.json();
        if (j.url) return { url: j.url, provider: "stripe" };
      } catch {}
      finally { clearTimeout(t); }
      return null;
    },
  },
];

// Fastest-wins parallel race (2.5s timeout per provider) — like MoonPay's multi-site speed
export async function createCheckoutWithFallback({ to, amount, env, origin, preferred }) {
  const configured = PROVIDERS.filter((p) => {
    const key = p.id === "stripe" ? env.STRIPE_SECRET_KEY : env[`${p.id.toUpperCase()}_API_KEY`];
    return !!key;
  });
  // No provider configured → instant mock (demo, no limit, fastest)
  if (configured.length === 0) {
    return { url: `https://checkout.mock/gdmx/${to}/${amount}/${Date.now()}`, provider: "mock", mock: true };
  }
  const order = preferred
    ? [...configured.filter((p) => p.id === preferred), ...configured.filter((p) => p.id !== preferred)]
    : configured;

  // If preferred, try it first with 800ms head start, then race rest
  if (preferred) {
    const pref = order[0];
    const headStart = await Promise.race([
      pref.createCheckout({ to, amount, env, origin }),
      new Promise((r) => setTimeout(() => r(null), 800)),
    ]);
    if (headStart?.url) return headStart;
  }

  // Parallel race — all remaining at once, fastest wins (Promise.any)
  const promises = order.map((p) => p.createCheckout({ to, amount, env, origin }).then((r) => r?.url ? r : Promise.reject()));
  try {
    const winner = await Promise.any(promises);
    return winner;
  } catch {
    // All failed → mock fallback (never blocks user)
    return { url: `https://checkout.mock/gdmx/${to}/${amount}/${Date.now()}`, provider: "mock", mock: true };
  }
}

export function listProviders(env) {
  return PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    logo: p.logo,
    fee: p.fee,
    configured: !!env[`${p.id.toUpperCase()}_API_KEY`] || (p.id === "stripe" && !!env.STRIPE_SECRET_KEY),
  }));
}
