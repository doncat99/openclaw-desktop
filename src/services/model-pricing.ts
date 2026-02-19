// ═══════════════════════════════════════════════════════════
// Model Pricing — Built-in pricing table for client-side cost calculation
// Prices in USD per 1M tokens (MTok)
// Source: Official provider pricing pages
// Last updated: 2026-02-17
// ═══════════════════════════════════════════════════════════

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// ── Built-in pricing table ──
// Key = model ID (without provider prefix), matching OpenClaw's model naming
// Values = USD per 1M tokens
const MODEL_PRICING: Record<string, ModelCost> = {
  // ── Anthropic ──
  'claude-opus-4-6':   { input: 5,    output: 25,   cacheRead: 0.50, cacheWrite: 6.25 },
  'claude-opus-4-5':   { input: 5,    output: 25,   cacheRead: 0.50, cacheWrite: 6.25 },
  'claude-opus-4-1':   { input: 15,   output: 75,   cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-opus-4':     { input: 15,   output: 75,   cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-sonnet-4-5': { input: 3,    output: 15,   cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-sonnet-4':   { input: 3,    output: 15,   cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-haiku-4-5':  { input: 1,    output: 5,    cacheRead: 0.10, cacheWrite: 1.25 },
  'claude-haiku-3-5':  { input: 0.80, output: 4,    cacheRead: 0.08, cacheWrite: 1.00 },

  // ── Google ──
  'gemini-2.5-pro':           { input: 1.25, output: 10,   cacheRead: 0, cacheWrite: 0 },
  'gemini-2.5-flash':         { input: 0.15, output: 0.60, cacheRead: 0, cacheWrite: 0 },
  'gemini-3-pro-preview':     { input: 1.25, output: 10,   cacheRead: 0, cacheWrite: 0 },
  'gemini-3-flash-preview':   { input: 0.15, output: 0.60, cacheRead: 0, cacheWrite: 0 },

  // ── OpenAI ──
  'gpt-4.1':           { input: 2,    output: 8,    cacheRead: 0.50, cacheWrite: 0 },
  'gpt-4.1-mini':      { input: 0.40, output: 1.60, cacheRead: 0.10, cacheWrite: 0 },
  'gpt-4.1-nano':      { input: 0.10, output: 0.40, cacheRead: 0.025, cacheWrite: 0 },
  'gpt-4o':            { input: 2.50, output: 10,   cacheRead: 1.25, cacheWrite: 0 },
  'gpt-4o-mini':       { input: 0.15, output: 0.60, cacheRead: 0.075, cacheWrite: 0 },
  'o3':                { input: 2,    output: 8,    cacheRead: 0.50, cacheWrite: 0 },
  'o3-mini':           { input: 1.10, output: 4.40, cacheRead: 0.275, cacheWrite: 0 },
  'o4-mini':           { input: 1.10, output: 4.40, cacheRead: 0.275, cacheWrite: 0 },

  // ── DeepSeek ──
  'deepseek-chat':     { input: 0.27, output: 1.10, cacheRead: 0.07, cacheWrite: 0 },
  'deepseek-reasoner': { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0 },
};

// ── Lookup with fuzzy matching ──
// Tries exact match first, then partial match for flexibility
export function getModelCost(modelId?: string): ModelCost | undefined {
  if (!modelId) return undefined;

  const id = modelId.trim().toLowerCase();

  // Strip provider prefix if present (e.g., "anthropic/claude-opus-4-6" → "claude-opus-4-6")
  const stripped = id.includes('/') ? id.split('/').pop()! : id;

  // Exact match
  if (MODEL_PRICING[stripped]) return MODEL_PRICING[stripped];

  // Fuzzy: find first key that the stripped ID starts with or contains
  for (const [key, cost] of Object.entries(MODEL_PRICING)) {
    if (stripped.startsWith(key) || stripped.includes(key)) return cost;
  }

  return undefined;
}

// ── Calculate cost from token counts ──
export function calculateCost(
  tokens: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number },
  pricing: ModelCost,
): number {
  const input   = (tokens.input    ?? 0) * pricing.input;
  const output  = (tokens.output   ?? 0) * pricing.output;
  const cRead   = (tokens.cacheRead  ?? 0) * pricing.cacheRead;
  const cWrite  = (tokens.cacheWrite ?? 0) * pricing.cacheWrite;
  return (input + output + cRead + cWrite) / 1_000_000;
}

// ── Calculate cost breakdown ──
export function calculateCostBreakdown(
  tokens: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number },
  pricing: ModelCost,
): { total: number; inputCost: number; outputCost: number; cacheReadCost: number; cacheWriteCost: number } {
  const inputCost      = ((tokens.input      ?? 0) * pricing.input)      / 1_000_000;
  const outputCost     = ((tokens.output     ?? 0) * pricing.output)     / 1_000_000;
  const cacheReadCost  = ((tokens.cacheRead  ?? 0) * pricing.cacheRead)  / 1_000_000;
  const cacheWriteCost = ((tokens.cacheWrite ?? 0) * pricing.cacheWrite) / 1_000_000;
  return {
    total: inputCost + outputCost + cacheReadCost + cacheWriteCost,
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
  };
}

// ═══════════════════════════════════════════════════════════
// Recalculate costs on Gateway response data
// Uses built-in pricing when Gateway returns missingCostEntries > 0
// ═══════════════════════════════════════════════════════════

interface CostTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  missingCostEntries: number;
}

interface ModelUsageEntry {
  provider?: string;
  model?: string;
  count: number;
  totals: CostTotals;
}

// Recalculate a CostTotals object using built-in pricing
// modelHint: the model ID to use for pricing lookup
function recalcTotals(totals: CostTotals, modelHint?: string): CostTotals {
  const pricing = getModelCost(modelHint);
  if (!pricing) return totals; // unknown model, can't help

  const breakdown = calculateCostBreakdown(totals, pricing);
  return {
    ...totals,
    totalCost: breakdown.total,
    inputCost: breakdown.inputCost,
    outputCost: breakdown.outputCost,
    cacheReadCost: breakdown.cacheReadCost,
    cacheWriteCost: breakdown.cacheWriteCost,
    missingCostEntries: 0,
  };
}

// Recalculate byModel array and return recalculated totals
function recalcByModel(byModel: ModelUsageEntry[]): { byModel: ModelUsageEntry[]; totals: CostTotals } {
  const totals: CostTotals = {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    totalTokens: 0, totalCost: 0, inputCost: 0, outputCost: 0,
    cacheReadCost: 0, cacheWriteCost: 0, missingCostEntries: 0,
  };

  const recalculated = byModel.map(entry => {
    const modelId = entry.model || '';
    const pricing = getModelCost(modelId);
    const newTotals = pricing ? recalcTotals(entry.totals, modelId) : entry.totals;

    // Accumulate
    totals.input          += newTotals.input;
    totals.output         += newTotals.output;
    totals.cacheRead      += newTotals.cacheRead;
    totals.cacheWrite     += newTotals.cacheWrite;
    totals.totalTokens    += newTotals.totalTokens;
    totals.totalCost      += newTotals.totalCost;
    totals.inputCost      += newTotals.inputCost;
    totals.outputCost     += newTotals.outputCost;
    totals.cacheReadCost  += newTotals.cacheReadCost;
    totals.cacheWriteCost += newTotals.cacheWriteCost;
    totals.missingCostEntries += newTotals.missingCostEntries;

    return { ...entry, totals: newTotals };
  });

  return { byModel: recalculated, totals };
}

// ── Main entry: patch full Gateway responses ──
export function patchCostData(costSummary: any, sessionsUsage: any): { costSummary: any; sessionsUsage: any } {
  // Check if recalculation is needed
  const costMissing = (costSummary?.totals?.missingCostEntries ?? 0) > 0;
  const usageMissing = (sessionsUsage?.totals?.missingCostEntries ?? 0) > 0;

  if (!costMissing && !usageMissing) {
    return { costSummary, sessionsUsage }; // Gateway already has all pricing — no patching needed
  }

  let patchedCost = costSummary;
  let patchedUsage = sessionsUsage;

  // ── Patch sessions usage (has model-level detail) ──
  if (patchedUsage && usageMissing) {
    // Recalculate per-session
    const patchedSessions = (patchedUsage.sessions || []).map((session: any) => {
      const modelUsage = session.usage?.modelUsage;
      if (!modelUsage?.length) {
        // Single-model session: use session-level model hint
        const modelId = session.model || session.modelProvider;
        if (modelId && (session.usage?.missingCostEntries ?? 0) > 0) {
          return { ...session, usage: recalcTotals(session.usage, modelId) };
        }
        return session;
      }

      // Multi-model session: recalculate from model breakdown
      const { byModel: patchedModelUsage, totals } = recalcByModel(modelUsage);
      return {
        ...session,
        usage: {
          ...session.usage,
          ...totals,
          modelUsage: patchedModelUsage,
        },
      };
    });

    // Recalculate aggregates.byModel → derive new totals
    const aggregates = patchedUsage.aggregates;
    let newAggregateTotals = patchedUsage.totals;
    let patchedAggregates = aggregates;

    if (aggregates?.byModel?.length) {
      const { byModel: patchedByModel, totals: aggTotals } = recalcByModel(aggregates.byModel);
      newAggregateTotals = aggTotals;

      // Recalculate byAgent from sessions
      const byAgentMap = new Map<string, CostTotals>();
      for (const s of patchedSessions) {
        const agentId = s.agentId || 'main';
        const existing = byAgentMap.get(agentId) || {
          input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
          totalTokens: 0, totalCost: 0, inputCost: 0, outputCost: 0,
          cacheReadCost: 0, cacheWriteCost: 0, missingCostEntries: 0,
        };
        const u = s.usage || {};
        existing.input          += u.input || 0;
        existing.output         += u.output || 0;
        existing.cacheRead      += u.cacheRead || 0;
        existing.cacheWrite     += u.cacheWrite || 0;
        existing.totalTokens    += u.totalTokens || 0;
        existing.totalCost      += u.totalCost || 0;
        existing.inputCost      += u.inputCost || 0;
        existing.outputCost     += u.outputCost || 0;
        existing.cacheReadCost  += u.cacheReadCost || 0;
        existing.cacheWriteCost += u.cacheWriteCost || 0;
        existing.missingCostEntries += u.missingCostEntries || 0;
        byAgentMap.set(agentId, existing);
      }

      const patchedByAgent = Array.from(byAgentMap.entries()).map(([agentId, totals]) => ({
        agentId,
        totals,
      }));

      patchedAggregates = {
        ...aggregates,
        byModel: patchedByModel,
        byAgent: patchedByAgent,
      };
    }

    patchedUsage = {
      ...patchedUsage,
      sessions: patchedSessions,
      totals: newAggregateTotals,
      aggregates: patchedAggregates,
    };
  }

  // ── Patch cost summary (daily) ──
  // Daily entries don't have per-model detail, so we derive from sessions totals
  if (patchedCost && costMissing && patchedUsage) {
    // Use the recalculated totals from sessions usage
    patchedCost = {
      ...patchedCost,
      totals: patchedUsage.totals || patchedCost.totals,
      // Recalculate daily entries proportionally
      daily: (patchedCost.daily || []).map((day: any) => {
        if ((day.missingCostEntries ?? 0) === 0) return day;
        // Scale: use the ratio of recalculated vs original totals
        const origTotal = costSummary?.totals?.totalCost || 1;
        const newTotal = patchedUsage?.totals?.totalCost || origTotal;
        const ratio = origTotal > 0 ? newTotal / origTotal : 1;

        // If original cost was 0 (all missing), estimate from tokens
        if (day.totalCost === 0 && day.totalTokens > 0) {
          // Use average cost per token from recalculated totals
          const avgCostPerToken = patchedUsage.totals.totalTokens > 0
            ? patchedUsage.totals.totalCost / patchedUsage.totals.totalTokens
            : 0;
          const estimatedCost = day.totalTokens * avgCostPerToken;
          const inputRatio = patchedUsage.totals.totalCost > 0
            ? patchedUsage.totals.inputCost / patchedUsage.totals.totalCost : 0.4;
          const outputRatio = patchedUsage.totals.totalCost > 0
            ? patchedUsage.totals.outputCost / patchedUsage.totals.totalCost : 0.5;
          const cacheReadRatio = patchedUsage.totals.totalCost > 0
            ? patchedUsage.totals.cacheReadCost / patchedUsage.totals.totalCost : 0.05;
          const cacheWriteRatio = patchedUsage.totals.totalCost > 0
            ? patchedUsage.totals.cacheWriteCost / patchedUsage.totals.totalCost : 0.05;

          return {
            ...day,
            totalCost: estimatedCost,
            inputCost: estimatedCost * inputRatio,
            outputCost: estimatedCost * outputRatio,
            cacheReadCost: estimatedCost * cacheReadRatio,
            cacheWriteCost: estimatedCost * cacheWriteRatio,
            missingCostEntries: 0,
          };
        }

        // Scale existing costs
        return {
          ...day,
          totalCost: day.totalCost * ratio,
          inputCost: (day.inputCost || 0) * ratio,
          outputCost: (day.outputCost || 0) * ratio,
          cacheReadCost: (day.cacheReadCost || 0) * ratio,
          cacheWriteCost: (day.cacheWriteCost || 0) * ratio,
          missingCostEntries: 0,
        };
      }),
    };
  }

  return { costSummary: patchedCost, sessionsUsage: patchedUsage };
}

// ── Export the raw table for display/debugging ──
export { MODEL_PRICING };
