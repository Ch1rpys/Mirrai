/**
 * Crisis-support resources.
 *
 * Checked on 2026-11-17 against the operators' own pages. The app still
 * does not fetch these numbers: the list ships with the binary so it is
 * available offline. `source` is the page that was opened; `lastVerified`
 * is that day.
 *
 * - cn-national `12356`: NDCPA seasonal-health briefing
 *   https://www.ndcpa.gov.cn/jbkzzx/c100009/common/content/content_1925026893781176320.html
 *   — all 31 provinces were running 12356. The NHC notice that named
 *   the number (circular 259, 6 December 2024) lived at nhc.gov.cn; this
 *   machine got HTTP 412 there, so the live source is the NDCPA page.
 * - cn-beijing `010-82951332`: Beijing Crisis Research and Intervention
 *   Centre, https://www.crisis.org.cn/lists/5.html — mobile 010-82951332.
 * - intl-directory `https://findahelpline.com`: the directory itself, and
 *   IASP at https://www.iasp.info/crisis-centres-helplines/ naming it as
 *   their partner.
 * - us `988`: https://988lifeline.org/ — "988 Suicide & Crisis Lifeline",
 *   call or text 988.
 * - ca `988`: https://www.canada.ca/en/public-health/services/suicide-prevention/government-canada-doing-help-prevent-suicide.html
 *   — "9-8-8: Suicide Crisis Helpline", call or text 9-8-8. A different
 *   service from the US line, run with the Government of Canada.
 */
import { existsSync, readFileSync } from "fs";
import { ENV } from "../_core/env";
import { copy } from "@shared/copy";

export interface CrisisResource {
  id: string;
  /** Display label, e.g. "中国大陆". */
  region: string;
  /** The label in the other language, when it has one. */
  regionEn?: string;
  /** What the resource is, in one line. */
  description: string;
  /** The description in the other language, when it has one. */
  descriptionEn?: string;
  /** The contact itself — a phone number or a URL. */
  contact: string;
  /** Official page that shows this number or address is current. */
  source: string;
  /**
   * ISO date a person last opened `source` and confirmed the contact.
   */
  lastVerified: string;
}

/**
 * The resources that ship with the app.
 *
 * The names, the numbers and the addresses are the part that matters and
 * they never change; the region and the description are labels, and they
 * are read by somebody in a bad moment, so they are in both languages.
 */
export const DEFAULT_CRISIS_RESOURCES: CrisisResource[] = [
  {
    id: "cn-national",
    region: copy("zh", "labels.crisis.region.cnNational"),
    regionEn: copy("en", "labels.crisis.region.cnNational"),
    description: copy("zh", "labels.crisis.description.cnNational"),
    descriptionEn: copy("en", "labels.crisis.description.cnNational"),
    contact: "12356",
    source: "https://www.ndcpa.gov.cn/jbkzzx/c100009/common/content/content_1925026893781176320.html",
    lastVerified: "2026-11-17",
  },
  {
    id: "cn-beijing",
    region: copy("zh", "labels.crisis.region.cnBeijing"),
    regionEn: copy("en", "labels.crisis.region.cnBeijing"),
    description: copy("zh", "labels.crisis.description.cnBeijing"),
    descriptionEn: copy("en", "labels.crisis.description.cnBeijing"),
    contact: "010-8295-1332",
    source: "https://www.crisis.org.cn/lists/5.html",
    lastVerified: "2026-11-17",
  },
  {
    id: "intl-directory",
    region: copy("zh", "labels.crisis.region.international"),
    regionEn: copy("en", "labels.crisis.region.international"),
    description: copy("zh", "labels.crisis.description.international"),
    descriptionEn: copy("en", "labels.crisis.description.international"),
    contact: "https://findahelpline.com",
    source: "https://findahelpline.com/",
    lastVerified: "2026-11-17",
  },
  {
    id: "us",
    region: copy("zh", "labels.crisis.region.us"),
    regionEn: copy("en", "labels.crisis.region.us"),
    description: copy("zh", "labels.crisis.description.us"),
    descriptionEn: copy("en", "labels.crisis.description.us"),
    contact: "988",
    source: "https://988lifeline.org/",
    lastVerified: "2026-11-17",
  },
  {
    id: "ca",
    region: copy("zh", "labels.crisis.region.ca"),
    regionEn: copy("en", "labels.crisis.region.ca"),
    description: copy("zh", "labels.crisis.description.ca"),
    descriptionEn: copy("en", "labels.crisis.description.ca"),
    contact: "988",
    source: "https://www.canada.ca/en/public-health/services/suicide-prevention/government-canada-doing-help-prevent-suicide.html",
    lastVerified: "2026-11-17",
  },
];

let cachedResources: CrisisResource[] | null = null;

/**
 * Returns the resource list, honouring the `SAFETY_RESOURCES_FILE` override.
 */
export function getCrisisResources(): CrisisResource[] {
  if (cachedResources) return cachedResources;

  if (ENV.safetyResourcesFile && existsSync(ENV.safetyResourcesFile)) {
    try {
      const parsed = JSON.parse(readFileSync(ENV.safetyResourcesFile, "utf-8"));
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedResources = parsed as CrisisResource[];
        return cachedResources;
      }
      console.warn(
        "[Safety] SAFETY_RESOURCES_FILE did not contain a non-empty array; using the built-in list.",
      );
    } catch (e) {
      console.warn("[Safety] Failed to read SAFETY_RESOURCES_FILE:", e);
    }
  }

  cachedResources = DEFAULT_CRISIS_RESOURCES;
  return cachedResources;
}

/**
 * Renders the resource list for a reply.
 *
 * The list is read by somebody who is in trouble, so the labels are in
 * the language they read — a region they cannot read is a region they
 * cannot look up.
 */
export function formatResources(
  resources: CrisisResource[] = getCrisisResources(),
  locale: "zh" | "en" = "zh",
): string {
  const separator = locale === "en" ? ": " : "：";
  return resources
    .map((r) => {
      const region = locale === "en" ? r.regionEn ?? r.region : r.region;
      const description = locale === "en" ? r.descriptionEn ?? r.description : r.description;
      return `· ${region} · ${description}${separator}${r.contact}`;
    })
    .join("\n");
}
