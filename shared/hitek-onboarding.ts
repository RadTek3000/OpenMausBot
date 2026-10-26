export const SHOP_STARTER_PROMPTS = [
  "Summarize new inquiries in my shop.",
  "Show quotes awaiting follow-up.",
  "What bookings are coming up?",
];

export function shopAssistantIntro(name: string) {
  return { title: `I'm ${name}.`, subtitle: "What needs attention in your shop today?" };
}
