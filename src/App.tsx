import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import GroupScreen from "./components/Group";
import MapView from "./components/Map";
import Profile from "./components/Profile";
import { supabase, type Group, type GroupMember } from "./lib/supabase";

type Tab = "map" | "group" | "profile";
type AuthMode = "login" | "signup";

function LoginForm({ onAuthenticated }: { onAuthenticated: () => void }) {
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

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setMessage({ text: "Enter email and password.", type: "error" });
      return;
    }
    if (password.length < 6) {
      setMessage({
        text: "Password must be at least 6 characters.",
        type: "error",
      });
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
          setMessage({
            text: "Account created! Check your email to confirm, then sign in.",
            type: "success",
          });
          setMode("login");
        }
      }
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : "Something went wrong.",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <h1>{mode === "login" ? "Sign in" : "Sign up"}</h1>
        <p className="subtitle">
          {mode === "login"
            ? "Camino de Mt.Doom to Mount Doom"
            : "Create an account to begin your journey"}
        </p>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label htmlFor="password">Password</label>
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

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading
              ? mode === "login"
                ? "Signing in…"
                : "Creating account…"
              : mode === "login"
                ? "Sign in"
                : "Sign up"}
          </button>
        </form>

        <div className="toggle-row">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setMessage(null);
            }}
          >
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </div>

        {message && (
          <div className={`message ${message.type}`}>{message.text}</div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
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
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
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
        <p className="subtitle">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return <LoginForm onAuthenticated={() => {}} />;
  }

  return (
    <div className="app-shell">
      <nav className="top-nav">
        <span className="app-title">Camino de Mt.Doom</span>
        <div className="nav-tabs">
          {(["map", "group", "profile"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`nav-tab${tab === t ? " active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
          <a href="#editor" className="nav-tab nav-tab-editor" title="Path Editor">
            ✎
          </a>
        </div>
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
