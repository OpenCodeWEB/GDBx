/**
 * gdmx-providers.js — Multi-provider on-ramp registry (no single limitation)
 * Like MoonPay: many providers, fallback, no single bottleneck.
 * Each provider is tried in order; if one fails, next is tried.
 */

export const PROVIDERS = [
  {
    id: "moonpay",
    name: "MoonPay",
    logo: "🌙",
    fee: "~1%",
    createCheckout: async ({ to, amount, env, origin }) => {
      const key = env.MOONPAY_API_KEY;
      if (!key) return null; // not configured → skip
      try {
        const res = await fetch("https://api.moonpay.com/v1/transactions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Api-Key ${key}` },
          body: JSON.stringify({ walletAddress: to, baseCurrencyAmount: Number(amount), baseCurrencyCode: "usd", currencyCode: "usdc", redirectURL: `${origin}/success` }),
        });
        const j = await res.json();
        if (j.widgetUrl || j.url) return { url: j.widgetUrl || j.url, provider: "moonpay" };
      } catch {}
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
      try {
        const res = await fetch("https://api.transak.com/api/v2/partners/order", {
          method: "POST",
          headers: { "content-type": "application/json", "api-key": key },
          body: JSON.stringify({ walletAddress: to, fiatAmount: Number(amount), fiatCurrency: "USD", cryptoCurrency: "USDC" }),
        });
        const j = await res.json();
        if (j.url || j.redirectUrl) return { url: j.url || j.redirectUrl, provider: "transak" };
      } catch {}
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
      try {
        const res = await fetch("https://api.ramp.network/api/host-api/v3/onramp", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Api-Key ${key}` },
          body: JSON.stringify({ destinationAddress: to, fiatValue: Number(amount), fiatCurrency: "USD", cryptoCurrency: "USDC" }),
        });
        const j = await res.json();
        if (j.url) return { url: j.url, provider: "ramp" };
      } catch {}
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
      return null; // placeholder — Coinbase Onramp requires OAuth app
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
      try {
        const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
          body: `success_url=${encodeURIComponent(`https://dsgx.pages.dev/success?to=${encodeURIComponent(to)}`)}&cancel_url=${encodeURIComponent(`https://dsgx.pages.dev/cancel`)}&mode=payment&line_items[0][price_data][currency]=usd&line_items[0][price_data][product_data][name]=Support+${encodeURIComponent(to)}&line_items[0][price_data][unit_amount]=${Math.round(Number(amount) * 100)}&line_items[0][quantity]=1`,
        });
        const j = await res.json();
        if (j.url) return { url: j.url, provider: "stripe" };
      } catch {}
      return null;
    },
  },
];

export async function createCheckoutWithFallback({ to, amount, env, origin, preferred }) {
  const order = preferred
    ? [...PROVIDERS.filter((p) => p.id === preferred), ...PROVIDERS.filter((p) => p.id !== preferred)]
    : PROVIDERS;
  for (const p of order) {
    const res = await p.createCheckout({ to, amount, env, origin });
    if (res?.url) return res;
  }
  // No provider configured → mock (demo, no limitation)
  return { url: `https://checkout.mock/gdmx/${to}/${amount}/${Date.now()}`, provider: "mock", mock: true };
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
