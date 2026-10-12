import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as client } from '../supabaseClient.js'

/** Single shared Supabase client (auth only — data goes through the backend API). */
export const supabase: SupabaseClient = client
