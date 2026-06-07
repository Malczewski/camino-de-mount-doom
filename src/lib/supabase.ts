import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  console.warn(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env",
  );
}

export const supabase = createClient(supabaseUrl ?? "", supabasePublishableKey ?? "", {
  auth: {
    persistSession: true,
    storage: localStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export interface Profile {
  id: string;
  display_name: string | null;
  total_steps: number;
  api_key: string | null;
}

export interface Group {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
}

// Returned by the get_group_members RPC — steps are relative to group creation date
export interface GroupMember {
  id: string;
  display_name: string;
  group_steps: number;
}
