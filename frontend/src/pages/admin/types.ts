export type Role = "user" | "admin";

export type ChatOnline = { user: boolean; admin: boolean };

export type JarEntry = { date: string; mood: string; message: string; created_at: number };
export type JarEntryBrief = { date: string; mood: string; created_at: number };

export type DashboardUser = {
  name: string;
  userNickname: string;
  loginEnabled: boolean;
  disableReason: string | null;
  lastActivity: number | null;
  security: UserSecurity;
};

export type DashboardJar = {
  available: boolean;
  today: JarEntry | null;
  lastOpened: JarEntryBrief | null;
};

export type DashboardStreak = {
  current_streak: number;
  longest_streak: number;
  last_open_date: string | null;
  garden_stage: number;
};

export type DashboardPet = {
  name: string;
  hunger: number;
  happiness: number;
  energy: number;
  stage: string;
  last_fed_at: number | null;
  last_played_at: number | null;
};

export type ChatMessageBrief = { sender: Role; body: string; kind: string; created_at: number };

export type DashboardChat = {
  online: ChatOnline;
  reachable: boolean;
  lastMessage: ChatMessageBrief | null;
  messageCount: number;
};

export type NotificationItem = {
  id: number;
  recipient: Role;
  type: string;
  title: string;
  body: string;
  read_at: number | null;
  created_at: number;
};

export type CalendarEvent = {
  id: number;
  title: string;
  description: string | null;
  event_date: string;
  event_time: string | null;
  created_by: Role;
};

export type GameScore = { score: number; message: string; created_at: number };

export type AdminAction = { action: string; detail: string; created_at: number };

export type Dashboard = {
  user: DashboardUser;
  jar: DashboardJar;
  streak: DashboardStreak;
  pet: DashboardPet;
  chat: DashboardChat;
  notifications: { unreadAdmin: number; unreadUser: number; recent: NotificationItem[] };
  calendar: { upcoming: CalendarEvent[] };
  game: { best: GameScore | null; recent: GameScore[] };
  activity: { recent: AdminAction[] };
  health: {
    aiConfigured: boolean;
    weatherConfigured: boolean;
    pushConfigured: boolean;
    pushSubscriptions: number;
    realtimeReachable: boolean;
  };
};

export type UserProfile = {
  name: string;
  userNickname: string;
  adminNickname: string;
  loginEnabled: boolean;
  disableReason: string | null;
  lastActivity: number | null;
  streak: { currentStreak: number; longestStreak: number };
  pet: { stage: string; happiness: number };
  notificationsUnread: number;
  sessions: { count: number; lastLoginAt: number | null };
};

export type LoginAttempt = { id: number; role: Role; success: number; reason: string | null; created_at: number };
export type SessionInfo = { role: Role; created_at: number; expires_at: number };

export type UserActivity = { attempts: LoginAttempt[]; sessions: SessionInfo[] };

// Compact login-security summary for the user, computed from login_attempts.
export type UserSecurity = {
  lastSuccess: number | null;
  failed24h: number;
  failedInWindow: number;
  blocked: boolean;
  locked: number;
  maxFailures: number;
  windowSeconds: number;
};

export type UserLoginHistory = {
  attempts: LoginAttempt[];
  nextBefore: number | undefined;
  summary: UserSecurity;
};

export type ResetRequest = {
  id: number;
  role: Role;
  status: string;
  reason: string | null;
  created_at: number;
  resolved_at: number | null;
};

export type JarStatus = {
  available: boolean;
  today: JarEntry | null;
  ai: {
    configured: boolean;
    lastGeneration: { mood: string; message: string; source: string; created_at: number } | null;
    counts: { gemini: number; fallback: number };
  };
};

export type Nickname = { role: Role; nickname: string };

export type PetState = { name: string; hunger: number; happiness: number; energy: number; stage: string };

export type HealthCheck = { key: string; label: string; status: "ok" | "warn" | "error"; detail: string };

export type SystemSecurity = {
  loginEnabled: boolean;
  disableReason: string | null;
  pendingPinRequests: number;
  sessions: { admin: number; user: number; lastAdminLoginAt: number | null };
  rateLimit: {
    windowSeconds: number;
    maxFailures: number;
    failedUserLast24h: number;
    failedAdminLast24h: number;
  };
  push: { configured: boolean; subscriptions: number; lastSeenAt: number | null };
};

export type SystemConfiguration = {
  appName: string;
  userName: string;
  adminEmail: string;
  timezone: { offsetMinutes: number; label: string };
  aiConfigured: boolean;
  weatherConfigured: boolean;
  pushConfigured: boolean;
};

export type PushStatus = {
  configured: boolean;
  subscriptions: number;
  lastSeenAt: number | null;
};

export type WeatherStatus = {
  configured: boolean;
  cached: unknown;
  updatedAt: number | null;
};

export type BucketItem = {
  id: number;
  title: string;
  description: string | null;
  completed: number;
  completed_at: number | null;
  created_by: Role;
  created_at: number;
};
