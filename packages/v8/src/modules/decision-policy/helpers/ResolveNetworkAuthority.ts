import type { RequestUnderstandingResult } from "../../request-understanding";

import type { DecisionReasonCode } from "../contracts";

/** Intents that may honestly need live web evidence when SearchPort exists. */
const LIVE_WEB_EVIDENCE_INTENTS = new Set([
  "docs",
  "question",
  "security",
  "dependency",
]);

/** True when the user message explicitly asks for a web/internet search. */
export function isExplicitWebSearchAsk(
  message: string,
  primaryTaskIntent?: RequestUnderstandingResult["intent"]["classification"]["primaryTaskIntent"],
): boolean {
  const intent = primaryTaskIntent ?? "question";
  if (!LIVE_WEB_EVIDENCE_INTENTS.has(intent)) {
    return false;
  }
  return (
    /\b(search\s+(?:the\s+)?(?:web|internet|docs?|documentation)|look\s+up|google)\b/i.test(
      message,
    ) ||
    /\b(?:check|find|search|look(?:\s+up)?)\b[\s\w,-]{0,48}\bonline\b/i.test(
      message,
    ) ||
    /\b(?:on\s+the\s+(?:web|internet)|search\s+online)\b/i.test(message)
  );
}

/**
 * External product / vendor / compatibility / “latest” facts that should not
 * be answered from model memory alone when SearchPort is available.
 */
export function needsLiveWebEvidence(
  message: string,
  primaryTaskIntent?: RequestUnderstandingResult["intent"]["classification"]["primaryTaskIntent"],
): boolean {
  const intent = primaryTaskIntent ?? "question";
  if (!LIVE_WEB_EVIDENCE_INTENTS.has(intent)) {
    return false;
  }
  if (
    /\b(?:this\s+(?:file|function|class|module|repo|code)|in\s+(?:the\s+)?(?:codebase|workspace|repository)|src\/|[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java))\b/i.test(
      message,
    )
  ) {
    return false;
  }
  if (
    (intent === "security" || intent === "dependency") &&
    /\b(?:vulnerabilit(?:y|ies)|cves?|advisories?|ghsa|nvd|osv)\b/i.test(
      message,
    ) &&
    /\b(?:online|web|internet|latest|known|published|advisory|advisories)\b/i.test(
      message,
    )
  ) {
    return true;
  }
  if (intent !== "docs" && intent !== "question") {
    return false;
  }
  return (
    /\b(?:compatible|compatibility|compat)\b/i.test(message) ||
    /\b(?:driver|firmware|datasheet|sku)\b/i.test(message) ||
    /\b(?:download|installer)\b/i.test(message) ||
    /\b(?:latest|current)\s+(?:version|release|software|driver|firmware)\b/i.test(
      message,
    ) ||
    /\b(?:software|driver)\s+(?:for|compatible\s+with)\b/i.test(message) ||
    (/\b(?:windows\s*(?:10|11)|macos|linux)\b/i.test(message) &&
      /\b(?:printer|scanner|device|hardware|zebra|epson|brother|hp)\b/i.test(
        message,
      )) ||
    /\b(?:which|what)\s+(?:software|driver|version|release)\b/i.test(message) ||
    /\b(?:vendor|oem)\s+(?:docs?|documentation|support)\b/i.test(message) ||
    (/\b[A-Z]{1,5}[- ]?\d{2,5}\b/.test(message) &&
      /\b(?:printer|scanner|device|software|driver|compatible)\b/i.test(message))
  );
}

export interface NetworkAuthority {
  allowedTools: string[];
  allowedEffects: Array<"network_access">;
  networkHosts: string[];
  reasonCodes: DecisionReasonCode[];
}

/**
 * Grant fetch_url / web_search when the request has concrete http(s) URLs,
 * an explicit search ask, or live-web evidence needs.
 */
export function resolveNetworkAuthority(params: {
  understanding: RequestUnderstandingResult;
  message?: string;
  allowNetwork: boolean;
  allowWebSearch: boolean;
}): NetworkAuthority {
  if (!params.allowNetwork) {
    return {
      allowedTools: [],
      allowedEffects: [],
      networkHosts: [],
      reasonCodes: [],
    };
  }

  const intent = params.understanding.intent.classification.primaryTaskIntent;
  const message = params.message ?? "";
  const hosts = extractNetworkHosts(message);
  const wantsSearch =
    isExplicitWebSearchAsk(message, intent) ||
    needsLiveWebEvidence(message, intent);

  if (hosts.length === 0 && !wantsSearch) {
    return {
      allowedTools: [],
      allowedEffects: [],
      networkHosts: [],
      reasonCodes: [],
    };
  }

  const allowedTools: string[] = [];
  if (hosts.length > 0 || (params.allowWebSearch && wantsSearch)) {
    allowedTools.push("fetch_url", "fetch_docs");
  }
  if (params.allowWebSearch && wantsSearch) {
    allowedTools.push("web_search");
  }

  if (allowedTools.length === 0) {
    return {
      allowedTools: [],
      allowedEffects: [],
      networkHosts: [],
      reasonCodes: [],
    };
  }

  return {
    allowedTools,
    allowedEffects: ["network_access"],
    networkHosts: hosts,
    reasonCodes: ["network_access_granted"],
  };
}

export function extractNetworkHosts(message: string): string[] {
  const hosts = new Set<string>();
  const pattern = /\bhttps?:\/\/([a-z0-9.-]+)(?::\d+)?(?:\/|\b)/gi;
  for (const match of message.matchAll(pattern)) {
    const host = match[1]?.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local")) {
      continue;
    }
    hosts.add(host);
  }
  return [...hosts].slice(0, 8);
}
