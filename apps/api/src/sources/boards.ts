import type { Ats } from "./connectors.js";

export interface Board {
  ats: Ats;
  token: string;
  company: string;
  regions: ("india" | "global")[];
}

/**
 * Seed list of public ATS boards, each verified to respond (2026-10-30). Users can add their own
 * target companies per research run. Re-verify periodically: companies switch ATS vendors.
 */
export const SEED_BOARDS: Board[] = [
  { ats: "greenhouse", token: "groww", company: "Groww", regions: ["india"] },
  { ats: "greenhouse", token: "razorpaysoftwareprivatelimited", company: "Razorpay", regions: ["india"] },
  { ats: "greenhouse", token: "druva", company: "Druva", regions: ["india", "global"] },
  { ats: "greenhouse", token: "hackerrank", company: "HackerRank", regions: ["india", "global"] },
  { ats: "greenhouse", token: "rubrik", company: "Rubrik", regions: ["india", "global"] },
  { ats: "greenhouse", token: "databricks", company: "Databricks", regions: ["india", "global"] },
  { ats: "greenhouse", token: "stripe", company: "Stripe", regions: ["india", "global"] },
  { ats: "greenhouse", token: "figma", company: "Figma", regions: ["global"] },
  { ats: "greenhouse", token: "airbnb", company: "Airbnb", regions: ["global"] },
  { ats: "greenhouse", token: "netradyne", company: "Netradyne", regions: ["india", "global"] },
  { ats: "greenhouse", token: "samsara", company: "Samsara", regions: ["india", "global"] },
  { ats: "greenhouse", token: "anthropic", company: "Anthropic", regions: ["global"] },
  { ats: "greenhouse", token: "scaleai", company: "Scale AI", regions: ["global"] },
  { ats: "greenhouse", token: "waymo", company: "Waymo", regions: ["global"] },
  { ats: "lever", token: "mindtickle", company: "Mindtickle", regions: ["india"] },
  { ats: "lever", token: "cred", company: "CRED", regions: ["india"] },
  { ats: "lever", token: "meesho", company: "Meesho", regions: ["india"] },
  { ats: "lever", token: "paytm", company: "Paytm", regions: ["india"] },
  { ats: "ashby", token: "sarvam", company: "Sarvam AI", regions: ["india"] },
  { ats: "ashby", token: "atlan", company: "Atlan", regions: ["india", "global"] },
  { ats: "ashby", token: "openai", company: "OpenAI", regions: ["global"] },
  { ats: "ashby", token: "notion", company: "Notion", regions: ["global"] },
  { ats: "ashby", token: "linear", company: "Linear", regions: ["global"] },
  { ats: "ashby", token: "ramp", company: "Ramp", regions: ["global"] },
];

const INDIA = /\b(india|bengaluru|bangalore|mumbai|pune|hyderabad|gurugram|gurgaon|delhi|noida|chennai|kolkata|ahmedabad|jaipur)\b/i;

export const isIndiaLocation = (loc: string | null | undefined) => Boolean(loc && INDIA.test(loc));

export function regionFor(location: string | null | undefined): "india" | "global" {
  return isIndiaLocation(location) ? "india" : "global";
}

/** Adzuna country code for a free-text location. */
export function adzunaCountry(location: string | null | undefined): string {
  const l = (location ?? "").toLowerCase();
  if (isIndiaLocation(l)) return "in";
  if (/\b(uk|united kingdom|london|england)\b/.test(l)) return "gb";
  if (/\b(germany|berlin|munich)\b/.test(l)) return "de";
  if (/\b(canada|toronto)\b/.test(l)) return "ca";
  if (/\b(singapore)\b/.test(l)) return "sg";
  return l ? "us" : "in";
}
