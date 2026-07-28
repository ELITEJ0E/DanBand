import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ConductorView from './components/ConductorView';
import ListenerView from './components/ListenerView';
import { Radio, Smartphone, Music, ChevronRight } from 'lucide-react';

type AppRole = 'select' | 'conductor' | 'listener';

export default function App() {
  const [role, setRole] = useState<AppRole>('select');

  // Push historical state so mobile browser back button works properly
  useEffect(() => {
    // Initial state setup to handle backward navigation to select screen
    if (!window.history.state || window.history.state.role !== 'select') {
      window.history.replaceState({ role: 'select' }, '');
    }

    const handlePopState = (e: PopStateEvent) => {
      if (e.state && typeof e.state.role === 'string') {
        setRole(e.state.role as AppRole);
      } else {
        setRole('select');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const changeRole = (newRole: AppRole) => {
    if (newRole === role) return;
    setRole(newRole);
    window.history.pushState({ role: newRole }, '');
  };

  const handleExitConductor = () => {
    if (confirm('Leave Conductor mode? This will disconnect all paired listeners.')) {
      changeRole('select');
    }
  };

  const handleExitListener = () => {
    changeRole('select');
  };

  return (
    <div className="min-h-screen bg-[#07070B] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#121225] via-[#07070B] to-[#030305] text-[#E0E0E0] flex flex-col font-sans selection:bg-[#00FF41] selection:text-zinc-950 relative overflow-x-hidden">
      
      {/* iOS-Style ambient background blur spots */}
      <div className="absolute top-[-10%] left-[-20%] w-[60%] aspect-square rounded-full bg-[#00FF41]/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[10%] right-[-20%] w-[50%] aspect-square rounded-full bg-[#3B82F6]/5 blur-[150px] pointer-events-none" />
      
      {/* Hardware Device Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />
      
      <AnimatePresence mode="wait">
        {role === 'select' && (
          <motion.div
            key="selection-screen"
            initial={{ opacity: 0, scale: 0.98, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -15 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 flex flex-col justify-between max-w-lg md:max-w-4xl lg:max-w-5xl mx-auto w-full p-5 md:p-10 relative z-10"
          >
            {/* Top Branding Section */}
            <header className="text-center pt-8 md:pt-16 pb-4">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/5 backdrop-blur-md border border-white/10 rounded-full text-[#00FF41] text-3xs font-mono uppercase tracking-widest mb-4 shadow-sm">
                <Music className="w-3 h-3 text-[#00FF41]" />
                <span>BETA v1.2</span>
              </div>
              <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white leading-none uppercase select-none">
                BAND<span className="text-[#00FF41] drop-shadow-[0_0_15px_rgba(0,255,65,0.45)]">DAN</span>
              </h1>
              <p className="text-2xs md:text-xs text-[#8E9299] mt-4 max-w-md mx-auto leading-relaxed font-mono uppercase tracking-wide">
                Broadcast visual chord shifts instantly to your bandmates using hand gesture recognition.
              </p>
            </header>

            {/* Main Selection Area */}
            <div className="flex-1 flex flex-col justify-center gap-6 py-8 md:py-12 w-full">
              <h2 className="text-4xs uppercase font-mono font-bold tracking-widest text-[#8E9299]/75 mb-1 text-center">
                [ SELECT YOUR ROLE ]
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl mx-auto">
                {/* Conductor Role Card */}
                <button
                  onClick={() => changeRole('conductor')}
                  className="group relative flex flex-col justify-between text-left p-6 md:p-8 bg-[#12121A]/40 backdrop-blur-xl border border-white/10 hover:border-[#00FF41]/60 rounded-3xl cursor-pointer transition-all duration-300 hover:shadow-[0_12px_40px_rgba(0,255,65,0.08)] active:scale-97 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
                >
                  {/* Highlight line top edge */}
                  <div className="absolute top-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  
                  <div className="flex flex-col gap-6 w-full">
                    <div className="bg-black/40 border border-white/5 group-hover:border-[#00FF41]/30 p-4 rounded-2xl w-14 h-14 flex items-center justify-center transition-all duration-300 group-hover:scale-105 shadow-inner">
                      <Radio className="w-7 h-7 text-[#00FF41] group-hover:animate-pulse" />
                    </div>
                    <div>
                      <h3 className="font-mono font-bold text-base md:text-lg text-white group-hover:text-[#00FF41] transition-colors uppercase tracking-wide">
                        BE THE CONDUCTOR
                      </h3>
                      <p className="text-4xs md:text-3xs text-[#8E9299] mt-2 leading-relaxed font-sans">
                        Use real-time camera gesture recognition to broadcast visual chord shifts directly to your bandmates&apos; screens. Manage song setlists and mapping presets instantly.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-500 group-hover:text-[#00FF41] transition-all duration-300 mt-6 md:mt-8 text-3xs font-mono uppercase tracking-widest">
                    <span>LAUNCH BROADCASTER</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>

                {/* Listener Role Card */}
                <button
                  onClick={() => changeRole('listener')}
                  className="group relative flex flex-col justify-between text-left p-6 md:p-8 bg-[#12121A]/40 backdrop-blur-xl border border-white/10 hover:border-[#00FF41]/60 rounded-3xl cursor-pointer transition-all duration-300 hover:shadow-[0_12px_40px_rgba(0,255,65,0.08)] active:scale-97 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
                >
                  {/* Highlight line top edge */}
                  <div className="absolute top-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />

                  <div className="flex flex-col gap-6 w-full">
                    <div className="bg-black/40 border border-white/5 group-hover:border-[#00FF41]/30 p-4 rounded-2xl w-14 h-14 flex items-center justify-center transition-all duration-300 group-hover:scale-105 shadow-inner">
                      <Smartphone className="w-7 h-7 text-[#00FF41]" />
                    </div>
                    <div>
                      <h3 className="font-mono font-bold text-base md:text-lg text-white group-hover:text-[#00FF41] transition-colors uppercase tracking-wide">
                        JOIN AS LISTENER
                      </h3>
                      <p className="text-4xs md:text-3xs text-[#8E9299] mt-2 leading-relaxed font-sans">
                        Receive chord signals instantly on your music stand or phone. Prompts full-screen high-contrast display shifts, tactile vibration beats, and low-light eye protection.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-500 group-hover:text-[#00FF41] transition-all duration-300 mt-6 md:mt-8 text-3xs font-mono uppercase tracking-widest">
                    <span>CONNECT TO SESSION</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {role === 'conductor' && (
          <motion.div
            key="conductor-screen"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col relative"
          >
            <ConductorView onExit={handleExitConductor} />
          </motion.div>
        )}

        {role === 'listener' && (
          <motion.div
            key="listener-screen"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col relative"
          >
            <ListenerView onExit={handleExitListener} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
