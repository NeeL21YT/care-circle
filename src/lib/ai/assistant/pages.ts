import type { Action } from "@/lib/domain/permissions";

/**
 * The app pages the assistant knows about. This fixed list is the ONLY source of links:
 * the model picks a key, the server builds the URL, and it is checked against the user's
 * permissions. The model never writes a URL, and a page the user cannot open is never offered.
 * No server-only imports here: the browser uses it too (current-page context, suggestions).
 */
export interface AssistantPage {
  label: string;
  /** Path under /patients/{patientId}. */
  path: string;
  /** Permission needed to open the page. */
  requires: Action;
  /** Shown as one-tap questions in the assistant when the user is on this page. */
  suggestions: string[];
}

export const ASSISTANT_PAGES = {
  overview: { label: "Overview", path: "", requires: "patient:read", suggestions: ["What needs my attention today?", "What medicines are still unanswered today?", "What is the next appointment?"] },
  medications: { label: "Medications", path: "/medications", requires: "medications:read", suggestions: ["What medicines are on the list?", "What is due tonight?", "When did I last report skipping a dose?"] },
  appointments: { label: "Appointments", path: "/appointments", requires: "appointments:read", suggestions: ["What is the next appointment?", "Where is the next appointment?", "How do I prepare a doctor brief?"] },
  documents: { label: "Documents", path: "/documents", requires: "documents:read", suggestions: ["What documents are saved?", "How do I scan a prescription?"] },
  tasks: { label: "Care tasks", path: "/tasks", requires: "tasks:read", suggestions: ["What tasks are open?", "Which tasks are overdue or have nobody responsible?", "What did people do recently?"] },
  handover: { label: "Care handover", path: "/handover", requires: "handovers:read", suggestions: ["What is in the latest handover?", "What still needs attention?", "How do I prepare a handover?"] },
  scanner: { label: "Prescription scanner", path: "/scanner", requires: "medications:write", suggestions: ["How does the prescription scanner work?", "What happens after I scan a prescription?"] },
  weekly: { label: "Weekly report", path: "/weekly", requires: "tasks:write", suggestions: ["How did this week go?", "How many doses were reported taken this week?"] },
  "care-circle": { label: "Care circle", path: "/care-circle", requires: "members:read", suggestions: ["Who is in the care circle?", "How do I invite a family member?"] },
  activity: { label: "Activity history", path: "/activity", requires: "audit:read", suggestions: ["What changed recently?"] },
  notifications: { label: "Notifications", path: "/notifications", requires: "notifications:read", suggestions: ["What are my notification settings?"] },
  assistant: { label: "Care assistant", path: "/assistant", requires: "patient:read", suggestions: ["What medicines do I need to take today?", "When is my next medicine?", "What is my next doctor appointment?", "Did I report taking my morning medicine?"] },
  settings: { label: "Settings", path: "/settings", requires: "patient:read", suggestions: ["How do I change the text size?"] },
} as const satisfies Record<string, AssistantPage>;

export type AssistantPageKey = keyof typeof ASSISTANT_PAGES;
export const ASSISTANT_PAGE_KEYS = Object.keys(ASSISTANT_PAGES) as [AssistantPageKey, ...AssistantPageKey[]];

export interface AssistantLink {
  label: string;
  path: string;
}

export const pagePath = (patientId: string, key: AssistantPageKey) => `/patients/${patientId}${ASSISTANT_PAGES[key].path}`;

/** Which app page a browser path belongs to (for "the user is looking at ..."), or null. */
export function pageKeyFromPath(pathname: string, patientId: string): AssistantPageKey | null {
  const base = `/patients/${patientId}`;
  if (pathname === base || pathname === `${base}/`) return "overview";
  const rest = pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : null;
  if (!rest) return null;
  const hit = (Object.keys(ASSISTANT_PAGES) as AssistantPageKey[]).find((k) => k !== "overview" && (rest === ASSISTANT_PAGES[k].path || rest.startsWith(`${ASSISTANT_PAGES[k].path}/`)));
  return hit ?? null;
}
