// Automatic WhatsApp messages through Meta's WhatsApp Cloud API. Off until
// WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set (Meta Business →
// WhatsApp → API Setup). Messages a business starts must use a template
// that Meta has approved; each template has one {{1}} slot for our text:
//   WHATSAPP_RATES_TEMPLATE  e.g. "Today's scrap rates from Scrap Express: {{1}}"
//   WHATSAPP_NEWS_TEMPLATE   e.g. "Scrap Express update: {{1}}"
const token = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const language = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
const TEMPLATES = {
  rates: process.env.WHATSAPP_RATES_TEMPLATE,
  news: process.env.WHATSAPP_NEWS_TEMPLATE,
};

const enabled = (kind) => Boolean(token && phoneNumberId && TEMPLATES[kind]);

// Meta rejects template text with line breaks, tabs or long runs of spaces.
const cleanParam = (text) => String(text).replace(/\s+/g, ' ').trim().slice(0, 900);

async function sendTemplate(kind, toPhone, text) {
  if (!enabled(kind)) throw new Error('WhatsApp is not set up');
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toPhone.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: TEMPLATES[kind],
        language: { code: language },
        components: [{ type: 'body', parameters: [{ type: 'text', text: cleanParam(text) }] }],
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`WhatsApp send failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

module.exports = { enabled, sendTemplate };
