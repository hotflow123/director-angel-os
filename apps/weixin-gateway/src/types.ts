export interface MinimalFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText?: string;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<MinimalFetchResponse>;

export type WeixinQrStatus =
  | "wait"
  | "scaned"
  | "confirmed"
  | "expired"
  | "scaned_but_redirect"
  | "need_verifycode"
  | "verify_code_blocked"
  | "binded_redirect";

export interface WeixinQrStartResponse {
  readonly qrcode?: string;
  readonly qrcode_img_content?: string;
}

export interface WeixinQrStatusResponse {
  readonly status?: WeixinQrStatus;
  readonly bot_token?: string;
  readonly ilink_bot_id?: string;
  readonly baseurl?: string;
  readonly ilink_user_id?: string;
  readonly redirect_host?: string;
  readonly errmsg?: string;
}

export interface WeixinLoginCredentials {
  readonly accountId: string;
  readonly token: string;
  readonly baseUrl: string;
  readonly userId?: string;
}

export interface WeixinAccount extends WeixinLoginCredentials {
  readonly normalizedAccountId: string;
  readonly savedAt: string;
}

export interface WeixinTextItem {
  readonly type: 1;
  readonly text_item?: {
    readonly text?: string;
  };
  readonly ref_msg?: {
    readonly title?: string;
    readonly message_item?: WeixinMessageItem;
  };
}

export interface WeixinVoiceItem {
  readonly type: 3;
  readonly voice_item?: {
    readonly text?: string;
    readonly media?: Record<string, unknown>;
  };
}

export interface WeixinMediaItem {
  readonly type: 2 | 4 | 5;
  readonly image_item?: Record<string, unknown>;
  readonly file_item?: Record<string, unknown>;
  readonly video_item?: Record<string, unknown>;
}

export type WeixinMessageItem = WeixinTextItem | WeixinVoiceItem | WeixinMediaItem;

export interface WeixinMessage {
  readonly message_id?: string | number;
  readonly seq?: string | number;
  readonly from_user_id?: string | number;
  readonly to_user_id?: string | number;
  readonly room_id?: string | number;
  readonly chat_room_id?: string | number;
  readonly msg_type?: number;
  readonly create_time_ms?: number | string;
  readonly context_token?: string | number;
  readonly item_list?: readonly WeixinMessageItem[];
}

export interface WeixinGetUpdatesResponse {
  readonly ret?: number;
  readonly errcode?: number;
  readonly errmsg?: string;
  readonly longpolling_timeout_ms?: number;
  readonly get_updates_buf?: string;
  readonly msgs?: readonly WeixinMessage[];
}

export interface WeixinSendMessageResponse {
  readonly ret?: number;
  readonly errcode?: number;
  readonly errmsg?: string;
}
