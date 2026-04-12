import React, { useState, useEffect } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { supabase } from '../supabaseClient';
import { Plus, Minus, LogOut, Clock, X, CheckCircle2 } from 'lucide-react';

interface DashboardProps {
  onLogout: () => void;
}

export default function Dashboard({ onLogout }: DashboardProps) {
  const [activeMode, setActiveMode] = useState<'idle' | 'scanning_restock' | 'scanning_sold'>('idle');
  const [pendingScan, setPendingScan] = useState<string | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recentScans, setRecentScans] = useState<any[]>([]);
  
  // Get staff session from device
  const sessionData = JSON.parse(localStorage.getItem('staff_session') || '{}');
  const staffName = sessionData.first_name || "Staff";

  // --- LIVE CAMERA ENGINE ---
  useEffect(() => {
    if (activeMode !== 'idle' && !pendingScan) {
      const scanner = new Html5QrcodeScanner(
        "barcode-reader", 
        { fps: 10, qrbox: { width: 300, height: 100 }, aspectRatio: 1.0 }, 
        false
      );

      scanner.render(
        (decodedText) => {
          scanner.clear();
          setPendingScan(decodedText);
        },
        (errorMessage) => { /* Ignore harmless scan cycle errors */ }
      );

      return () => {
        scanner.clear().catch(console.error);
      };
    }
  }, [activeMode, pendingScan]);

  // --- FETCH TODAY'S HISTORY ---
  useEffect(() => {
    const fetchHistory = async () => {
      if (!sessionData.boss_id) return;
      
      // Get today's date at midnight
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('*')
        .eq('staff_scanner_id', sessionData.scanner_id)
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false });

      if (!error && data) {
        setRecentScans(data);
      }
    };
    fetchHistory();
  }, [activeMode]); // Refetch after every action finishes

  // --- CONFIRM TRANSACTION TO SUPABASE ---
  const confirmTransaction = async () => {
    if (!pendingScan || !sessionData.boss_id) return;
    setIsProcessing(true);

    // 1. Look up the car model from your inventory using the barcode
    // NOTE: Replace 'live_inventory' with your actual table name if different!
    const { data: itemData, error: itemError } = await supabase
      .from('live_inventory')
      .select('car_brand, car_model, quantity')
      .eq('boss_id', sessionData.boss_id)
      .eq('barcode', pendingScan)
      .single();

    if (itemError || !itemData) {
      alert("Error: Barcode not found in inventory!");
      setIsProcessing(false);
      return;
    }

    const carName = `${itemData.car_brand} ${itemData.car_model}`;
    const transactionType = activeMode === 'scanning_restock' ? 'RESTOCK' : 'SOLD_OFFLINE';

    // 2. Update the Live Inventory Quantity
    const newQuantity = transactionType === 'RESTOCK' ? itemData.quantity + 1 : itemData.quantity - 1;
    
    await supabase
      .from('live_inventory')
      .update({ quantity: newQuantity })
      .eq('boss_id', sessionData.boss_id)
      .eq('barcode', pendingScan);

    // 3. Write to the Immutable Ledger
    const { error: ledgerError } = await supabase
      .from('inventory_transactions')
      .insert([{
        boss_id: sessionData.boss_id,
        staff_scanner_id: sessionData.scanner_id,
        barcode: pendingScan,
        car_model_snapshot: carName,
        transaction_type: transactionType
      }]);

    setIsProcessing(false);
    
    if (ledgerError) {
      alert("Error saving transaction to ledger.");
    } else {
      setPendingScan(null);
      setActiveMode('idle'); 
    }
  };

  const handleLogoutClick = () => {
    if (window.confirm("Are you sure you want to sign out?")) {
      localStorage.removeItem('staff_session');
      onLogout();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-20">
      <header className="bg-white px-6 py-4 flex justify-between items-center shadow-sm">
        <div>
          <h1 className="text-xl font-black text-slate-800 tracking-tight">AutoGlass Staff</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{staffName}</p>
        </div>
        <button onClick={handleLogoutClick} className="p-2 text-slate-400 hover:text-red-500 bg-slate-50 rounded-full transition-colors">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      <main className="p-6 max-w-md mx-auto space-y-6">
        {activeMode === 'idle' ? (
          <div className="bg-white p-2 rounded-2xl shadow-sm flex gap-2">
            <button 
              onClick={() => setActiveMode('scanning_restock')}
              className="flex-1 py-4 flex items-center justify-center gap-2 rounded-xl text-teal-600 font-bold hover:bg-teal-50 transition-colors"
            >
              <Plus className="w-5 h-5" /> Add to Inventory
            </button>
            <div className="w-px bg-slate-100 my-2"></div>
            <button 
              onClick={() => setActiveMode('scanning_sold')}
              className="flex-1 py-4 flex items-center justify-center gap-2 rounded-xl text-slate-600 font-bold hover:bg-slate-100 transition-colors"
            >
              <Minus className="w-5 h-5" /> Sold Offline
            </button>
          </div>
        ) : (
          <div className="bg-slate-900 rounded-2xl p-4 shadow-lg">
            <p className="text-center text-cyan-400 font-medium tracking-wide mb-4 mt-2">
              Scanning for <span className={activeMode === 'scanning_restock' ? 'text-teal-400 font-bold' : 'text-red-400 font-bold'}>{activeMode === 'scanning_restock' ? 'RESTOCK' : 'SALE'}</span>
            </p>
            
            <div id="barcode-reader" className="w-full bg-black rounded-lg overflow-hidden border-2 border-slate-700 min-h-[200px]"></div>

            <div className="mt-6 flex justify-center">
              <button 
                onClick={() => setActiveMode('idle')} 
                className="px-8 py-2.5 bg-slate-800 text-slate-300 rounded-full font-bold text-sm hover:bg-slate-700"
              >
                Cancel Scan
              </button>
            </div>
          </div>
        )}

        {/* TODAY'S ACTIVITY WIDGET */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Clock className="w-5 h-5 text-slate-400" /> Today's Activity
            </h2>
            <button onClick={() => setShowHistoryModal(true)} className="text-sm font-bold text-cyan-600 hover:text-cyan-700">
              View All
            </button>
          </div>
          <div className="space-y-3">
            {recentScans.slice(0, 3).map(scan => (
              <div key={scan.id} className="bg-white p-4 rounded-2xl shadow-sm flex justify-between items-center border border-slate-100">
                <div>
                  <p className="font-bold text-slate-800 text-sm">{scan.car_model_snapshot}</p>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    {scan.barcode} • {new Date(scan.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </p>
                </div>
                <span className={`text-[10px] font-black tracking-wider uppercase px-2.5 py-1 rounded-full ${scan.transaction_type === 'RESTOCK' ? 'bg-teal-50 text-teal-600' : 'bg-red-50 text-red-500'}`}>
                  {scan.transaction_type}
                </span>
              </div>
            ))}
            {recentScans.length === 0 && (
              <p className="text-center text-slate-400 text-sm py-4">No scans yet today.</p>
            )}
          </div>
        </div>
      </main>

      {/* CONFIRMATION MODAL */}
      {pendingScan && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl">
            <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${activeMode === 'scanning_restock' ? 'bg-teal-100 text-teal-600' : 'bg-red-100 text-red-500'}`}>
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-black text-slate-800 mb-2">Confirm Action</h2>
            <p className="text-slate-500 mb-6">
              You are about to <span className={`font-bold ${activeMode === 'scanning_restock' ? 'text-teal-600' : 'text-red-500'}`}>{activeMode === 'scanning_restock' ? 'RESTOCK' : 'SELL'}</span> item:
            </p>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-6">
              <p className="font-mono text-xl font-bold text-slate-800 tracking-widest">{pendingScan}</p>
            </div>
            <div className="flex gap-3">
              <button 
                disabled={isProcessing}
                onClick={() => setPendingScan(null)} 
                className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200"
              >
                Cancel
              </button>
              <button 
                disabled={isProcessing}
                onClick={confirmTransaction} 
                className={`flex-1 py-3.5 text-white rounded-xl font-bold shadow-lg ${activeMode === 'scanning_restock' ? 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/20' : 'bg-red-500 hover:bg-red-600 shadow-red-500/20'} disabled:opacity-70`}
              >
                {isProcessing ? 'Processing...' : `Confirm ${activeMode === 'scanning_restock' ? 'Add' : 'Sale'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULL SCREEN HISTORY MODAL */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-slate-50 z-[60] flex flex-col">
          <header className="bg-white px-6 py-4 flex items-center justify-between shadow-sm sticky top-0">
            <h2 className="text-xl font-black text-slate-800">Complete History</h2>
            <button onClick={() => setShowHistoryModal(false)} className="p-2 bg-slate-100 rounded-full text-slate-500">
              <X className="w-5 h-5" />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {recentScans.map(scan => (
               <div key={`modal-${scan.id}`} className="bg-white p-4 rounded-2xl shadow-sm flex justify-between items-center border border-slate-100">
                 <div>
                   <p className="font-bold text-slate-800 text-sm">{scan.car_model_snapshot}</p>
                   <p className="text-xs text-slate-400 font-mono mt-0.5">
                     {scan.barcode} • {new Date(scan.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                   </p>
                 </div>
                 <span className={`text-[10px] font-black tracking-wider uppercase px-2.5 py-1 rounded-full ${scan.transaction_type === 'RESTOCK' ? 'bg-teal-50 text-teal-600' : 'bg-red-50 text-red-500'}`}>
                   {scan.transaction_type}
                 </span>
               </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}