import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Session } from "@supabase/supabase-js";
import GroupScreen from "./components/Group";
import MapView from "./components/Map";
import Profile from "./components/Profile";
import { supabase, type Group, type GroupMember } from "./lib/supabase";

type Tab = "map" | "group" | "profile";
type AuthMode = "login" | "signup" | "forgot";

function LangToggle() {
  const { i18n } = useTranslation();
  return (
    <button
      type="button"
      className="link-btn"
      style={{ fontSize: "0.75rem", opacity: 0.7 }}
      onClick={() => void i18n.changeLanguage(i18n.language === "uk" ? "en" : "uk")}
    >
      {i18n.language === "uk" ? "EN" : "UA"}
    </button>
  );
}

function LoginForm({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "error" | "success";
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (mode === "forgot") {
      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        setMessage({ text: t("auth.enterEmail"), type: "error" });
        return;
      }
      setLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: window.location.origin,
      });
      setLoading(false);
      if (error) {
        setMessage({ text: error.message, type: "error" });
      } else {
        setMessage({ text: t("auth.checkEmailReset"), type: "success" });
      }
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setMessage({ text: t("auth.enterEmailAndPassword"), type: "error" });
      return;
    }
    if (password.length < 6) {
      setMessage({ text: t("auth.passwordTooShort"), type: "error" });
      return;
    }

    setLoading(true);

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;
        onAuthenticated();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;

        if (data.session) {
          onAuthenticated();
        } else {
          setMessage({ text: t("auth.accountCreated"), type: "success" });
          setMode("login");
        }
      }
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : t("auth.somethingWentWrong"),
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  if (mode === "forgot") {
    return (
      <div className="auth-screen">
        <div className="card auth-card">
          <div style={{ textAlign: "right", marginBottom: "0.25rem" }}>
            <LangToggle />
          </div>
          <h1>{t("auth.resetPassword")}</h1>
          <p className="subtitle">{t("auth.resetSubtitle")}</p>

          <form onSubmit={(e) => void handleSubmit(e)}>
            <label htmlFor="email">{t("auth.email")}</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? t("auth.sending") : t("auth.sendResetLink")}
            </button>
          </form>

          <div className="toggle-row">
            <button
              type="button"
              className="link-btn"
              onClick={() => { setMode("login"); setMessage(null); }}
            >
              {t("auth.backToSignIn")}
            </button>
          </div>

          {message && (
            <div className={`message ${message.type}`}>{message.text}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <div style={{ textAlign: "right", marginBottom: "0.25rem" }}>
          <LangToggle />
        </div>
        <h1>{mode === "login" ? t("auth.signIn") : t("auth.signUp")}</h1>
        <p className="subtitle">
          {mode === "login" ? t("auth.signInSubtitle") : t("auth.signUpSubtitle")}
        </p>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <label htmlFor="email">{t("auth.email")}</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label htmlFor="password">{t("auth.password")}</label>
          <input
            id="password"
            type="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />

          {mode === "login" && (
            <div style={{ textAlign: "right", marginTop: "-0.5rem", marginBottom: "1rem" }}>
              <button
                type="button"
                className="link-btn"
                onClick={() => { setMode("forgot"); setMessage(null); }}
              >
                {t("auth.forgotPassword")}
              </button>
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading
              ? mode === "login"
                ? t("auth.signingIn")
                : t("auth.creatingAccount")
              : mode === "login"
                ? t("auth.signIn")
                : t("auth.signUp")}
          </button>
        </form>

        <div className="toggle-row">
          {mode === "login" ? t("auth.noAccount") : t("auth.alreadyHaveAccount")}{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setMessage(null);
            }}
          >
            {mode === "login" ? t("auth.signUp") : t("auth.signIn")}
          </button>
        </div>

        {message && (
          <div className={`message ${message.type}`}>{message.text}</div>
        )}
      </div>
    </div>
  );
}

function ResetPasswordForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "error" | "success";
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setMessage({ text: t("auth.passwordsDoNotMatch"), type: "error" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setMessage({ text: error.message, type: "error" });
    } else {
      setMessage({ text: t("auth.passwordUpdated"), type: "success" });
      setTimeout(onDone, 1500);
    }
  };

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <div style={{ textAlign: "right", marginBottom: "0.25rem" }}>
          <LangToggle />
        </div>
        <h1>{t("auth.setNewPassword")}</h1>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <label htmlFor="password">{t("auth.newPassword")}</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          <label htmlFor="confirm">{t("auth.confirmPassword")}</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={6}
            required
          />
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? t("auth.saving") : t("auth.setPassword")}
          </button>
        </form>

        {message && (
          <div className={`message ${message.type}`}>{message.text}</div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isRecovery, setIsRecovery] = useState(
    () => window.location.hash.includes("type=recovery"),
  );
  const [tab, setTab] = useState<Tab>("map");
  const [userGroups, setUserGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [mapMembers, setMapMembers] = useState<GroupMember[]>([]);
  const mapMemberIdsRef = useRef<Set<string>>(new Set());

  const userId = session?.user.id ?? "";

  useEffect(() => {
    mapMemberIdsRef.current = new Set(mapMembers.map((m) => m.id));
  }, [mapMembers]);

  const loadUserGroups = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("group_members")
      .select("groups(id, name, invite_code, created_at)")
      .eq("user_id", uid);

    const groups: Group[] = (data ?? [])
      .map((row) => row.groups as unknown as Group | null)
      .filter((g): g is Group => g !== null);

    setUserGroups(groups);

    setActiveGroupId((prev) => {
      if (prev && groups.some((g) => g.id === prev)) return prev;
      const stored = localStorage.getItem("active-group-id");
      if (stored && groups.some((g) => g.id === stored)) return stored;
      return groups[0]?.id ?? null;
    });
  }, []);

  const loadMapMembers = useCallback(async (gid: string | null) => {
    if (!gid) {
      setMapMembers([]);
      return;
    }

    const { data, error } = await supabase.rpc("get_group_members", { p_group_id: gid });

    if (error) {
      console.error("Failed to load map members:", error.message);
      return;
    }

    setMapMembers((data ?? []) as GroupMember[]);
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
      if (data.session?.user.id) {
        void loadUserGroups(data.session.user.id);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      } else if (event === "USER_UPDATED") {
        setIsRecovery(false);
      }
      setSession(nextSession);
      if (nextSession?.user.id) {
        void loadUserGroups(nextSession.user.id);
      } else {
        setUserGroups([]);
        setActiveGroupId(null);
        setMapMembers([]);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadUserGroups]);

  useEffect(() => {
    void loadMapMembers(activeGroupId);
  }, [activeGroupId, loadMapMembers]);

  useEffect(() => {
    if (activeGroupId) {
      localStorage.setItem("active-group-id", activeGroupId);
    } else {
      localStorage.removeItem("active-group-id");
    }
  }, [activeGroupId]);

  useEffect(() => {
    if (!activeGroupId) return;

    const channel = supabase
      .channel(`map-group-${activeGroupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "step_logs" },
        (payload) => {
          const row = payload.new as { user_id?: string } | null;
          const eventUserId =
            row?.user_id ??
            (payload.old as { user_id?: string } | null)?.user_id;
          if (eventUserId && mapMemberIdsRef.current.has(eventUserId)) {
            void loadMapMembers(activeGroupId);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          const row = payload.new as { id?: string };
          if (row.id && mapMemberIdsRef.current.has(row.id)) {
            void loadMapMembers(activeGroupId);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_members",
          filter: `group_id=eq.${activeGroupId}`,
        },
        () => {
          void loadMapMembers(activeGroupId);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeGroupId, loadMapMembers]);

  if (!authReady) {
    return (
      <div className="auth-screen">
        <p className="subtitle">{t("auth.loading")}</p>
      </div>
    );
  }

  if (isRecovery && session) {
    return <ResetPasswordForm onDone={() => setIsRecovery(false)} />;
  }

  if (!session) {
    return <LoginForm onAuthenticated={() => {}} />;
  }

  return (
    <div className="app-shell">
      <nav className="top-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/icon.png" alt="" width={28} height={28} style={{ borderRadius: 6, flexShrink: 0 }} />
          <span className="app-title">{t("nav.appTitle")}</span>
        </div>
        <div className="nav-tabs">
          {(["map", "group", "profile"] as const).map((tabId) => (
            <button
              key={tabId}
              type="button"
              className={`nav-tab${tab === tabId ? " active" : ""}`}
              onClick={() => setTab(tabId)}
            >
              {t(`nav.${tabId}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="link-btn"
          style={{ fontSize: "0.75rem", opacity: 0.7, marginLeft: "0.5rem" }}
          onClick={() => void i18n.changeLanguage(i18n.language === "uk" ? "en" : "uk")}
        >
          {i18n.language === "uk" ? "EN" : "UA"}
        </button>
      </nav>

      <main className={`main-content${tab === "map" ? " map-main" : ""}`}>
        {tab === "map" && (
          <MapView
            members={mapMembers}
            currentUserId={userId}
            userGroups={userGroups}
            activeGroupId={activeGroupId}
            onActiveGroupChange={(id) => setActiveGroupId(id)}
          />
        )}
        {tab === "group" && (
          <GroupScreen
            userId={userId}
            userGroups={userGroups}
            activeGroupId={activeGroupId}
            onGroupsChange={() => loadUserGroups(userId)}
            onActiveGroupChange={(id) => {
              setActiveGroupId(id);
              void loadMapMembers(id);
            }}
          />
        )}
        {tab === "profile" && (
          <Profile
            userId={userId}
            onAccountDeleted={() => {
              setSession(null);
              setUserGroups([]);
              setActiveGroupId(null);
              setMapMembers([]);
            }}
            onLogout={() => {
              setSession(null);
              setUserGroups([]);
              setActiveGroupId(null);
              setMapMembers([]);
            }}
          />
        )}
      </main>
    </div>
  );
}
