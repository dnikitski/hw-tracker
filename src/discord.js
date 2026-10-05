const LIMIT = 1900; // Discord rejects messages over 2000 characters

// <t:…> renders in each reader's own timezone, with a live "in 3 days" countdown.
const stamp = (iso) => {
  const seconds = Math.floor(new Date(iso) / 1000);
  return `<t:${seconds}:f> (<t:${seconds}:R>)`;
};
export const itemLine = (item) => `• **${item.course}** ${item.title} — ${stamp(item.due)}`;

export async function post(webhook, heading, lines = []) {
  if (!webhook) return;
  let content = heading;
  let shown = 0;
  for (const line of lines) {
    if (content.length + line.length + 1 > LIMIT) break;
    content += `\n${line}`;
    shown++;
  }
  if (shown < lines.length) content += `\n…and ${lines.length - shown} more`;
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  if (!response.ok) throw new Error(`Discord webhook failed: ${response.status}`);
}
