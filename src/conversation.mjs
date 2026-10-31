export function conversationHistory(chat, budget = 48000) {
  const selected = [];
  let used = 0;
  for (const message of [...chat].reverse()) {
    if (message.status !== "complete" || typeof message.text !== "string")
      continue;
    if (
      selected.length >= 12 ||
      used + message.text.length > budget ||
      message.text.length > 20000
    )
      break;
    selected.push({ role: message.role, content: message.text });
    used += message.text.length;
  }
  selected.reverse();
  while (selected[0]?.role === "assistant") selected.shift();
  return selected;
}
