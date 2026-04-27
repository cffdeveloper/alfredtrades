// Reviews a closed trade with Lovable AI and stores the verdict + suggested weight adjustments.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { symbol, exitTradeId } = await req.json();
    if (!symbol || !exitTradeId) {
      return new Response(JSON.stringify({ error: "symbol and exitTradeId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the exit trade
    const { data: exitTrade } = await supabase.from("bot_trades")
      .select("*").eq("id", exitTradeId).single();
    if (!exitTrade) throw new Error("exit trade not found");

    // Find matching entry: most recent buy of same symbol before this exit
    const { data: entryTrade } = await supabase.from("bot_trades")
      .select("*")
      .eq("symbol", symbol)
      .eq("side", "buy")
      .lt("created_at", exitTrade.created_at)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!entryTrade) {
      return new Response(JSON.stringify({ skipped: "no matching entry" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Recent signals around entry for context
    const { data: signals } = await supabase.from("bot_signals")
      .select("signal, reason, regime, rsi, adx, zscore, strategy, confidence, price, created_at")
      .eq("symbol", symbol)
      .lte("created_at", entryTrade.created_at)
      .order("created_at", { ascending: false })
      .limit(3);

    const entryPrice = Number(entryTrade.price);
    const exitPrice = Number(exitTrade.price);
    const qty = Number(exitTrade.qty);
    const pnl = (exitPrice - entryPrice) * qty;
    const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    const holdSec = Math.floor(
      (new Date(exitTrade.created_at).getTime() - new Date(entryTrade.created_at).getTime()) / 1000
    );
    const regime = signals?.[0]?.regime ?? null;
    const exitReason = exitTrade.strategy ?? "unknown";

    // Ask Lovable AI for a structured verdict
    let aiVerdict = "AI review unavailable";
    let aiLesson = "";
    let weightAdjustments: Array<{ signal_name: string; regime: string; delta: number }> = [];
    let modelUsed = "google/gemini-3-flash-preview";

    if (LOVABLE_API_KEY) {
      const userPrompt = `Closed trade review:
Symbol: ${symbol}
Entry: $${entryPrice.toFixed(2)} | Exit: $${exitPrice.toFixed(2)} | Qty: ${qty}
P&L: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)
Hold: ${holdSec}s | Exit reason: ${exitReason} | Regime at entry: ${regime ?? "n/a"}
Entry signals: ${JSON.stringify(signals?.slice(0, 3) ?? [])}

Analyze concisely: was this a quality trade? What signal/regime worked or failed? Suggest weight tweaks (-0.2 to +0.2) for known signals: rsi_oversold, macd_cross, vwap_reclaim, zscore_mean_revert, trend_follow, mean_revert.`;

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelUsed,
          messages: [
            { role: "system", content: "You are a disciplined trading analyst. Review closed trades and suggest small weight adjustments to improve future signal selection. Be concise and quantitative." },
            { role: "user", content: userPrompt },
          ],
          tools: [{
            type: "function",
            function: {
              name: "submit_review",
              description: "Return the trade verdict and suggested weight adjustments.",
              parameters: {
                type: "object",
                properties: {
                  verdict: { type: "string", description: "1-2 sentence verdict (good/bad trade and why)" },
                  lesson: { type: "string", description: "1 sentence actionable lesson" },
                  weight_adjustments: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        signal_name: { type: "string", enum: ["rsi_oversold","macd_cross","vwap_reclaim","zscore_mean_revert","trend_follow","mean_revert"] },
                        regime: { type: "string", enum: ["all","trending","ranging","volatile"] },
                        delta: { type: "number", description: "weight delta between -0.2 and +0.2" },
                      },
                      required: ["signal_name", "regime", "delta"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["verdict", "lesson", "weight_adjustments"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "submit_review" } },
        }),
      });

      if (aiResp.status === 429 || aiResp.status === 402) {
        aiVerdict = aiResp.status === 429 ? "Rate limited — review skipped" : "AI credits exhausted — review skipped";
      } else if (aiResp.ok) {
        const data = await aiResp.json();
        const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        if (args) {
          const parsed = JSON.parse(args);
          aiVerdict = parsed.verdict ?? aiVerdict;
          aiLesson = parsed.lesson ?? "";
          weightAdjustments = Array.isArray(parsed.weight_adjustments) ? parsed.weight_adjustments : [];
        }
      } else {
        console.error("AI gateway error", aiResp.status, await aiResp.text());
      }
    }

    // Save review
    await supabase.from("trade_reviews").insert({
      symbol,
      entry_price: entryPrice,
      exit_price: exitPrice,
      qty,
      pnl,
      pnl_pct: pnlPct,
      hold_seconds: holdSec,
      exit_reason: exitReason,
      regime,
      entry_signals: signals ?? [],
      ai_verdict: aiVerdict,
      ai_lesson: aiLesson,
      ai_weight_adjustments: weightAdjustments,
      model: modelUsed,
      entry_trade_id: entryTrade.id,
      exit_trade_id: exitTrade.id,
    });

    // Apply weight adjustments (clamped 0.3..2.0)
    const won = pnl > 0;
    for (const adj of weightAdjustments) {
      const { data: existing } = await supabase.from("signal_weights")
        .select("*").eq("signal_name", adj.signal_name).eq("regime", adj.regime).maybeSingle();
      if (existing) {
        const newWeight = Math.max(0.3, Math.min(2.0, Number(existing.weight) + Number(adj.delta)));
        await supabase.from("signal_weights").update({
          weight: newWeight,
          wins: existing.wins + (won ? 1 : 0),
          losses: existing.losses + (won ? 0 : 1),
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
      } else {
        await supabase.from("signal_weights").insert({
          signal_name: adj.signal_name,
          regime: adj.regime,
          weight: Math.max(0.3, Math.min(2.0, 1.0 + Number(adj.delta))),
          wins: won ? 1 : 0,
          losses: won ? 0 : 1,
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, pnl, verdict: aiVerdict }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("review-trade error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
