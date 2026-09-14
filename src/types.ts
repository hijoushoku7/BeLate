export interface Env {
  DB: D1Database;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LIFF_ID: string;
}

export type EventState = 'draft' | 'open' | 'locked' | 'running' | 'settled';

export interface EventRow {
  id: string; group_id: string; owner_id: string; place_lat: number; place_lng: number;
  place_name: string | null; meet_at: number; state: EventState; base_fine: number;
  per_min: number; max_fine: number; created_at: number; settled_at: number | null;
}

export interface ParticipantRow {
  event_id: string; user_id: string; display_name: string | null; status: 'joining' | 'absent';
  arrived_at: number | null; late_minutes: number | null; fine: number | null;
}

export type LineSource = { type: 'user'; userId: string } |
  { type: 'group'; groupId: string; userId?: string } |
  { type: 'room'; roomId: string; userId?: string };

export interface LineEvent {
  type: string; timestamp: number; replyToken?: string; source: LineSource;
  message?: { id: string; type: string; text?: string; latitude?: number; longitude?: number; address?: string; title?: string;
    mention?: { mentionees?: { index: number; length: number; isSelf?: boolean }[] } };
  postback?: { data: string; params?: { datetime?: string } };
}

export type LineMessage = Record<string, unknown>;
