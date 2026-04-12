import React, { useState } from 'react';
import { supabase } from '../supabaseClient'; // Make sure your path is correct!
import { Hexagon, ArrowRight } from 'lucide-react';

interface LoginProps {
  onLogin: () => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [shopId, setShopId] = useState('');
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');
    
    // 1. Query the retail_staff table
    const { data, error } = await supabase
      .from('retail_staff')
      .select('boss_id, first_name, status')
      .eq('scanner_id', shopId.toUpperCase())
      .eq('pin_code', pin)
      .single();

    if (error || !data) {
      setErrorMsg("Invalid Scanner ID or PIN.");
      setIsLoading(false);
      return;
    }

    if (data.status === 'Blocked') {
      setErrorMsg("Access Denied: Account is suspended.");
      setIsLoading(false);
      return;
    }

    // 2. Save session to device memory
    localStorage.setItem('staff_session', JSON.stringify({
      scanner_id: shopId.toUpperCase(),
      boss_id: data.boss_id,
      first_name: data.first_name
    }));
    
    // 3. Tell App.tsx to switch to Dashboard
    onLogin();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-400/10 blur-[100px] rounded-full"></div>

      <div className="text-center mb-8 relative z-10">
        <div className="w-16 h-16 bg-cyan-600 rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg shadow-cyan-600/20">
          <Hexagon className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-black text-slate-800 tracking-tight">AutoGlass Staff</h1>
        <p className="text-slate-500 text-sm">Inventory Management Portal</p>
      </div>

      <div className="w-full max-w-sm bg-white p-8 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 relative z-10">
        <form onSubmit={handleStaffLogin} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Shop ID (Scanner ID)</label>
            <input 
              required
              type="text"
              value={shopId}
              onChange={(e) => setShopId(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none transition-all uppercase"
              placeholder="e.g. S34AUTOGL-..."
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Staff PIN</label>
            <input 
              required
              type="password"
              maxLength={4}
              pattern="\d{4}"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none transition-all font-mono tracking-widest text-lg"
              placeholder="••••"
            />
          </div>

          {errorMsg && <p className="text-red-500 text-sm font-bold text-center">{errorMsg}</p>}

          <button 
            disabled={isLoading}
            className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-cyan-600/20 flex items-center justify-center gap-2 mt-2 disabled:opacity-70"
          >
            {isLoading ? 'Connecting...' : 'Authenticate'} <ArrowRight className="w-5 h-5" />
          </button>
        </form>
      </div>
      
      <p className="text-xs font-bold text-slate-400 mt-8 relative z-10">Authorized Personnel Only • v1.2.4</p>
    </div>
  );
}