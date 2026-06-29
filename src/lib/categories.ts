// The Category enum mirrored for UI: label, emoji icon, and a stable color used
// by both the donut and the feed tiles. Keep keys in sync with prisma Category.
export const CATEGORIES = {
  FLIGHTS: { label: "Flights", icon: "✈️", color: "#8b5cf6" },
  HOTELS: { label: "Hotels", icon: "🏨", color: "#06b6d4" },
  FOOD: { label: "Food & Dining", icon: "🍽️", color: "#f59e0b" },
  ACTIVITIES: { label: "Activities", icon: "🎫", color: "#ec4899" },
  SHOPPING: { label: "Shopping", icon: "🛒", color: "#10b981" },
  OTHER: { label: "Other", icon: "💳", color: "#64748b" },
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];

export function categoryMeta(key: string) {
  return CATEGORIES[key as CategoryKey] ?? CATEGORIES.OTHER;
}
