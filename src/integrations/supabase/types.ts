export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bot_runs: {
        Row: {
          created_at: string
          daily_pl: number | null
          duration_ms: number | null
          halt_entries: boolean | null
          id: string
          market_open: boolean | null
          message: string | null
          regime_summary: Json | null
          signals_generated: number | null
          status: string
          symbols_processed: number | null
          trades_executed: number | null
        }
        Insert: {
          created_at?: string
          daily_pl?: number | null
          duration_ms?: number | null
          halt_entries?: boolean | null
          id?: string
          market_open?: boolean | null
          message?: string | null
          regime_summary?: Json | null
          signals_generated?: number | null
          status: string
          symbols_processed?: number | null
          trades_executed?: number | null
        }
        Update: {
          created_at?: string
          daily_pl?: number | null
          duration_ms?: number | null
          halt_entries?: boolean | null
          id?: string
          market_open?: boolean | null
          message?: string | null
          regime_summary?: Json | null
          signals_generated?: number | null
          status?: string
          symbols_processed?: number | null
          trades_executed?: number | null
        }
        Relationships: []
      }
      bot_signals: {
        Row: {
          adx: number | null
          atr: number | null
          confidence: number | null
          created_at: string
          id: string
          price: number
          reason: string | null
          regime: string | null
          rsi: number | null
          signal: string
          sma_fast: number | null
          sma_slow: number | null
          strategy: string | null
          symbol: string
          vwap: number | null
          zscore: number | null
        }
        Insert: {
          adx?: number | null
          atr?: number | null
          confidence?: number | null
          created_at?: string
          id?: string
          price: number
          reason?: string | null
          regime?: string | null
          rsi?: number | null
          signal: string
          sma_fast?: number | null
          sma_slow?: number | null
          strategy?: string | null
          symbol: string
          vwap?: number | null
          zscore?: number | null
        }
        Update: {
          adx?: number | null
          atr?: number | null
          confidence?: number | null
          created_at?: string
          id?: string
          price?: number
          reason?: string | null
          regime?: string | null
          rsi?: number | null
          signal?: string
          sma_fast?: number | null
          sma_slow?: number | null
          strategy?: string | null
          symbol?: string
          vwap?: number | null
          zscore?: number | null
        }
        Relationships: []
      }
      bot_trades: {
        Row: {
          alpaca_order_id: string | null
          confidence: number | null
          created_at: string
          id: string
          price: number
          qty: number
          side: string
          stop_price: number | null
          strategy: string | null
          symbol: string
          target_price: number | null
          value: number
        }
        Insert: {
          alpaca_order_id?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          price: number
          qty: number
          side: string
          stop_price?: number | null
          strategy?: string | null
          symbol: string
          target_price?: number | null
          value: number
        }
        Update: {
          alpaca_order_id?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          price?: number
          qty?: number
          side?: string
          stop_price?: number | null
          strategy?: string | null
          symbol?: string
          target_price?: number | null
          value?: number
        }
        Relationships: []
      }
      portfolio_snapshots: {
        Row: {
          buying_power: number
          cash: number
          created_at: string
          daily_pl: number | null
          equity: number
          id: string
          portfolio_value: number
          positions: Json
        }
        Insert: {
          buying_power: number
          cash: number
          created_at?: string
          daily_pl?: number | null
          equity: number
          id?: string
          portfolio_value: number
          positions?: Json
        }
        Update: {
          buying_power?: number
          cash?: number
          created_at?: string
          daily_pl?: number | null
          equity?: number
          id?: string
          portfolio_value?: number
          positions?: Json
        }
        Relationships: []
      }
      signal_weights: {
        Row: {
          id: string
          losses: number
          regime: string
          signal_name: string
          updated_at: string
          weight: number
          wins: number
        }
        Insert: {
          id?: string
          losses?: number
          regime?: string
          signal_name: string
          updated_at?: string
          weight?: number
          wins?: number
        }
        Update: {
          id?: string
          losses?: number
          regime?: string
          signal_name?: string
          updated_at?: string
          weight?: number
          wins?: number
        }
        Relationships: []
      }
      trade_reviews: {
        Row: {
          ai_lesson: string | null
          ai_verdict: string | null
          ai_weight_adjustments: Json | null
          created_at: string
          entry_price: number
          entry_signals: Json | null
          entry_trade_id: string | null
          exit_price: number
          exit_reason: string | null
          exit_trade_id: string | null
          hold_seconds: number | null
          id: string
          model: string | null
          pnl: number
          pnl_pct: number
          qty: number
          regime: string | null
          symbol: string
        }
        Insert: {
          ai_lesson?: string | null
          ai_verdict?: string | null
          ai_weight_adjustments?: Json | null
          created_at?: string
          entry_price: number
          entry_signals?: Json | null
          entry_trade_id?: string | null
          exit_price: number
          exit_reason?: string | null
          exit_trade_id?: string | null
          hold_seconds?: number | null
          id?: string
          model?: string | null
          pnl: number
          pnl_pct: number
          qty: number
          regime?: string | null
          symbol: string
        }
        Update: {
          ai_lesson?: string | null
          ai_verdict?: string | null
          ai_weight_adjustments?: Json | null
          created_at?: string
          entry_price?: number
          entry_signals?: Json | null
          entry_trade_id?: string | null
          exit_price?: number
          exit_reason?: string | null
          exit_trade_id?: string | null
          hold_seconds?: number | null
          id?: string
          model?: string | null
          pnl?: number
          pnl_pct?: number
          qty?: number
          regime?: string | null
          symbol?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
