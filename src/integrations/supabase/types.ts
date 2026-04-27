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
      dm_balance: {
        Row: {
          balance: number
          created_at: string
          currency: string
          id: string
          loginid: string | null
        }
        Insert: {
          balance: number
          created_at?: string
          currency?: string
          id?: string
          loginid?: string | null
        }
        Update: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          loginid?: string | null
        }
        Relationships: []
      }
      dm_candidates: {
        Row: {
          barrier: number | null
          contract_type: string
          created_at: string
          ev: number | null
          id: string
          payout_ratio: number | null
          picked: boolean | null
          run_id: string | null
          stat_confidence: number | null
          symbol: string
          win_prob_statistical: number | null
          win_prob_theoretical: number | null
        }
        Insert: {
          barrier?: number | null
          contract_type: string
          created_at?: string
          ev?: number | null
          id?: string
          payout_ratio?: number | null
          picked?: boolean | null
          run_id?: string | null
          stat_confidence?: number | null
          symbol: string
          win_prob_statistical?: number | null
          win_prob_theoretical?: number | null
        }
        Update: {
          barrier?: number | null
          contract_type?: string
          created_at?: string
          ev?: number | null
          id?: string
          payout_ratio?: number | null
          picked?: boolean | null
          run_id?: string | null
          stat_confidence?: number | null
          symbol?: string
          win_prob_statistical?: number | null
          win_prob_theoretical?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dm_candidates_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "dm_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_runs: {
        Row: {
          best_ev: number | null
          candidates_scanned: number | null
          created_at: string
          duration_ms: number | null
          id: string
          message: string | null
          status: string
          ticks_collected: number | null
          trades_executed: number | null
        }
        Insert: {
          best_ev?: number | null
          candidates_scanned?: number | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          message?: string | null
          status: string
          ticks_collected?: number | null
          trades_executed?: number | null
        }
        Update: {
          best_ev?: number | null
          candidates_scanned?: number | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          message?: string | null
          status?: string
          ticks_collected?: number | null
          trades_executed?: number | null
        }
        Relationships: []
      }
      dm_state: {
        Row: {
          consec_losses: number
          cooldown_until: string | null
          id: number
          peak_balance: number | null
          session_start_balance: number | null
          session_started_at: string
          updated_at: string
        }
        Insert: {
          consec_losses?: number
          cooldown_until?: string | null
          id?: number
          peak_balance?: number | null
          session_start_balance?: number | null
          session_started_at?: string
          updated_at?: string
        }
        Update: {
          consec_losses?: number
          cooldown_until?: string | null
          id?: number
          peak_balance?: number | null
          session_start_balance?: number | null
          session_started_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      dm_ticks: {
        Row: {
          created_at: string
          epoch: number
          id: string
          last_digit: number
          quote: number
          symbol: string
        }
        Insert: {
          created_at?: string
          epoch: number
          id?: string
          last_digit: number
          quote: number
          symbol: string
        }
        Update: {
          created_at?: string
          epoch?: number
          id?: string
          last_digit?: number
          quote?: number
          symbol?: string
        }
        Relationships: []
      }
      dm_trades: {
        Row: {
          barrier: number | null
          contract_id: string | null
          contract_type: string
          created_at: string
          entry_quote: number | null
          ev: number | null
          exit_quote: number | null
          id: string
          payout: number | null
          payout_ratio: number | null
          pnl: number | null
          reasoning: string | null
          settled_at: string | null
          stake: number
          stat_confidence: number | null
          status: string
          strategy: string | null
          symbol: string
          win_prob_statistical: number | null
          win_prob_theoretical: number | null
          won: boolean | null
        }
        Insert: {
          barrier?: number | null
          contract_id?: string | null
          contract_type: string
          created_at?: string
          entry_quote?: number | null
          ev?: number | null
          exit_quote?: number | null
          id?: string
          payout?: number | null
          payout_ratio?: number | null
          pnl?: number | null
          reasoning?: string | null
          settled_at?: string | null
          stake: number
          stat_confidence?: number | null
          status?: string
          strategy?: string | null
          symbol: string
          win_prob_statistical?: number | null
          win_prob_theoretical?: number | null
          won?: boolean | null
        }
        Update: {
          barrier?: number | null
          contract_id?: string | null
          contract_type?: string
          created_at?: string
          entry_quote?: number | null
          ev?: number | null
          exit_quote?: number | null
          id?: string
          payout?: number | null
          payout_ratio?: number | null
          pnl?: number | null
          reasoning?: string | null
          settled_at?: string | null
          stake?: number
          stat_confidence?: number | null
          status?: string
          strategy?: string | null
          symbol?: string
          win_prob_statistical?: number | null
          win_prob_theoretical?: number | null
          won?: boolean | null
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
