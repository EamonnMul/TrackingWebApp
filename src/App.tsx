import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User } from 'firebase/auth';
import { Sun, Moon } from 'lucide-react';
import { auth } from './firebase';
import BottomNav from './components/BottomNav';
import LogScreen from './screens/LogScreen';
import ProgressScreen from './screens/ProgressScreen';
import TodoScreen from './screens/TodoScreen';
import TodayScreen from './screens/TodayScreen';
import DailyCheckIn, { shouldShowCheckIn, markCheckInDone } from './components/DailyCheckIn';

export default function App() {
  const [user, setUser] = useState<User | null | 'loading'>('loading');
  const [dark, setDark] = useState(() => localStorage.getItem('theme') !== 'light');
  const [showCheckIn, setShowCheckIn] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    return onAuthStateChanged(auth, u => {
      setUser(u);
      if (u) setShowCheckIn(shouldShowCheckIn());
    });
  }, []);

  if (user === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-ink flex items-center justify-center">
        <div className="w-9 h-9 border-2 border-cobalt-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <SignInPage dark={dark} onToggleTheme={() => setDark(d => !d)} />;
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50 dark:bg-ink relative">
        {/* Subtle radial vignette in dark mode */}
        <div
          className="hidden dark:block fixed inset-0 pointer-events-none -z-10"
          style={{
            background:
              'radial-gradient(circle at 50% 0%, rgba(61,123,255,0.08), transparent 55%)',
          }}
        />

        {/* Theme toggle */}
        <button
          onClick={() => setDark(d => !d)}
          className="fixed top-4 right-4 z-50 w-9 h-9 rounded-full
                     bg-white dark:bg-ink-surface
                     border border-slate-200 dark:border-line
                     shadow-card hover:shadow-elevated
                     flex items-center justify-center
                     text-slate-600 dark:text-slate-300
                     hover:text-cobalt-500 dark:hover:text-cobalt-400
                     active:scale-95 transition-all"
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <div className="max-w-lg mx-auto px-4 pt-6 pb-28">
          <Routes>
            <Route path="/today" element={<TodayScreen />} />
            <Route path="/" element={<LogScreen />} />
            <Route path="/progress" element={<ProgressScreen />} />
            <Route path="/tasks" element={<TodoScreen />} />
          </Routes>
        </div>
        <BottomNav />
        {showCheckIn && (
          <DailyCheckIn onDismiss={() => { markCheckInDone(); setShowCheckIn(false); }} />
        )}
      </div>
    </BrowserRouter>
  );
}

/* ─── Sign-in page ────────────────────────────────────────────────────────── */

function SignInPage({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function signIn() {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch {
      setError('Sign in failed. Try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-ink flex flex-col items-center justify-center px-6 relative overflow-hidden">
      {/* Glow background */}
      <div
        className="hidden dark:block absolute inset-0 pointer-events-none -z-10"
        style={{
          background:
            'radial-gradient(circle at 50% 30%, rgba(61,123,255,0.16), transparent 55%), radial-gradient(circle at 80% 90%, rgba(255,122,26,0.08), transparent 50%)',
        }}
      />

      <button
        onClick={onToggleTheme}
        className="fixed top-4 right-4 z-50 w-9 h-9 rounded-full
                   bg-white dark:bg-ink-surface
                   border border-slate-200 dark:border-line shadow-card
                   flex items-center justify-center
                   text-slate-600 dark:text-slate-300 active:scale-95 transition-all"
        aria-label="Toggle theme"
      >
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <div className="text-center mb-12 animate-fade-in">
        <p className="eyebrow-fire mb-3">Big Dawg · Built Different</p>
        <h1 className="text-5xl font-black tracking-tight text-slate-900 dark:text-white leading-[0.95]">
          Track the<br />
          <span className="bg-gradient-to-r from-cobalt-400 to-cobalt-500 bg-clip-text text-transparent">
            grind.
          </span>
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-4 text-base">
          Daily reps. Real habits. No fluff.
        </p>
      </div>

      <button
        onClick={signIn}
        disabled={loading}
        className="inline-flex items-center gap-3 bg-white text-gray-800 font-semibold
                   px-6 py-3.5 rounded-2xl shadow-deep
                   hover:bg-gray-50 active:scale-[0.98] transition-all
                   disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? (
          <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <GoogleIcon />
        )}
        {loading ? 'Signing in…' : 'Sign in with Google'}
      </button>

      {error && (
        <p className="text-red-400 text-sm mt-4 animate-fade-in">{error}</p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4" />
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853" />
      <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05" />
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
    </svg>
  );
}
