import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode'; 
import { supabase } from '../supabaseClient';
import { Plus, Minus, LogOut, Clock, X, CheckCircle2, Camera as CameraIcon, Image as ImageIcon } from 'lucide-react';

interface DashboardProps {
  onLogout: () => void;
}

export default function Dashboard({ onLogout }: DashboardProps) {
  const [transactionType, setTransactionType] = useState<'RESTOCK' | 'SOLD_OFFLINE' | null>(null);
  const [scanMethod, setScanMethod] = useState<'camera' | null>(null);
  const [pendingScan, setPendingScan] = useState<string | null>(null);
  
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recentScans, setRecentScans] = useState<any[]>([]); // Initialize as empty array to prevent white screen
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sessionData = JSON.parse(localStorage.getItem('staff_session') || '{}');
  const staffName = sessionData.first_name || "Staff";
  // Safely grab either seller_id or boss_id depending on your retail_staff table structure
  const activeBossId = sessionData.seller_id || sessionData.boss_id; 

  // --- HARDWARE-SAFE CAMERA LOGIC ---
  useEffect(() => {
    let isMounted = true; // Safety switch to prevent ghost crashes

    if (scanMethod === 'camera') {
      // WAIT 100ms for React to physically draw the black screen before turning on the lens
      setTimeout(() => {
        if (!isMounted) return;

        const scanner = new Html5Qrcode("camera-reader");
        scannerRef.current = scanner;

        scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 300, height: 150 } },
          (decodedText) => {
            if (!isMounted) return;
            handleSuccessfulScan(decodedText);
          },
          (error) => { /* Ignore background frame errors */ }
        ).catch((err) => {
          if (!isMounted) return;
          console.error("Camera Boot Error:", err);
          alert("Camera blocked. Please refresh the page and allow permissions.");
          stopCamera(false);
        });
      }, 100);
    }

    // Cleanup function if the user aggressively closes the window
    return () => {
      isMounted = false;
      if (scannerRef.current) {
        scannerRef.current.stop().then(() => scannerRef.current?.clear()).catch(() => {});
      }
    };
  }, [scanMethod]);

  // Handle a successful barcode read
  const handleSuccessfulScan = async (text: string) => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (e) {}
      scannerRef.current = null;
    }
    setScanMethod(null);
    setPendingScan(text); // Locks in the barcode!
  };

  // Handle the user clicking the Cancel "X" button
  const stopCamera = async (isSuccess = false) => {
    if (scannerRef.current) {
      try {
        // Safely ask the camera hardware to power down
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (err) {
        console.log("Camera safely aborted during boot sequence.");
      }
      scannerRef.current = null;
    }
    
    setScanMethod(null);
    if (!isSuccess) setTransactionType(null); 
  };

  // --- SAFE HISTORY FETCH ---
  useEffect(() => {
    const fetchHistory = async () => {
      if (!activeBossId) return;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('*')
        .eq('staff_scanner_id', sessionData.scanner_id)
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false });

      // Prevent white screen crash if data comes back null
      if (error || !data) {
        setRecentScans([]); 
      } else {
        setRecentScans(data);
      }
    };
    fetchHistory();
  }, [refreshTrigger]);

  // --- STRICT DATABASE TRANSACTION ---
  const confirmTransaction = async () => {
    if (!pendingScan || !activeBossId || !transactionType) return;
    setIsProcessing(true);

    try {
      // 1. Check Live Inventory using seller_id
      const { data: inventoryItem, error: invError } = await supabase
        .from('live_inventory')
        .select('inventory_id, quantity') 
        .eq('seller_id', activeBossId) // FIXED: Matches your table
        .eq('factory_barcode', pendingScan) 
        .maybeSingle();

      if (invError) {
        alert("Inventory Fetch Error: " + invError.message);
        setIsProcessing(false);
        return;
      }

      // 2. Get Name from Dictionary
      const { data: dictItem } = await supabase
        .from('barcode_dictionary')
        .select('master_sku')
        .eq('factory_barcode', pendingScan)
        .maybeSingle();

      if (!dictItem) {
        alert("Barcode not found in Master Dictionary.");
        setIsProcessing(false);
        return;
      }

      const finalCarName = dictItem.master_sku;

      // 3. Process the Data
      if (inventoryItem) {
        // UPDATE Existing
        const newQuantity = transactionType === 'RESTOCK' 
          ? inventoryItem.quantity + 1 
          : Math.max(0, inventoryItem.quantity - 1); 
        
        const { error: updateError } = await supabase
          .from('live_inventory')
          .update({ quantity: newQuantity })
          .eq('inventory_id', inventoryItem.inventory_id);

        if (updateError) throw updateError;

      } else {
        // INSERT New
        if (transactionType === 'SOLD_OFFLINE') {
          alert("Cannot sell: This item is not on your shelf yet.");
          setIsProcessing(false);
          return;
        }

        // STRICT INSERT: Only seller_id, factory_barcode, and quantity
        const { error: insertError } = await supabase
          .from('live_inventory')
          .insert([{
            seller_id: activeBossId, // FIXED
            factory_barcode: pendingScan, 
            quantity: 1
          }]);

        if (insertError) throw insertError;
      }

      // 4. Ledger Update (Using boss_id as that's what we named the column in this table earlier)
      await supabase
        .from('inventory_transactions')
        .insert([{
          boss_id: activeBossId, 
          staff_scanner_id: sessionData.scanner_id,
          barcode: pendingScan,
          car_model_snapshot: finalCarName,
          transaction_type: transactionType
        }]);

      setPendingScan(null);
      setTransactionType(null);
      setRefreshTrigger(prev => prev + 1); 
      
    } catch (err: any) {
      alert("Database Error: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogoutClick = () => {
    if (window.confirm("Sign out?")) {
      localStorage.removeItem('staff_session');
      onLogout();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-20">
      <div id="hidden-file-reader" style={{ display: 'none' }}></div>
      <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      <header className="bg-white px-6 py-4 flex justify-between items-center shadow-sm">
        <div>
          <h1 className="text-xl font-black text-slate-800 tracking-tight">AutoGlass Staff</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{staffName}</p>
        </div>
        <button onClick={handleLogoutClick} className="p-2 text-slate-400 hover:text-red-500 bg-slate-50 rounded-full"><LogOut className="w-5 h-5" /></button>
      </header>

      <main className="p-6 max-w-md mx-auto space-y-8 mt-4">
        <div className="flex flex-col gap-4">
          <button onClick={() => setTransactionType('RESTOCK')} className="w-full py-6 flex items-center justify-center gap-3 rounded-2xl bg-teal-500 text-white font-black text-xl shadow-lg shadow-teal-500/30 hover:bg-teal-600 active:scale-95">
            <Plus className="w-7 h-7" /> ADD TO INVENTORY
          </button>
          <button onClick={() => setTransactionType('SOLD_OFFLINE')} className="w-full py-6 flex items-center justify-center gap-3 rounded-2xl bg-red-500 text-white font-black text-xl shadow-lg shadow-red-500/30 hover:bg-red-600 active:scale-95">
            <Minus className="w-7 h-7" /> SOLD OFFLINE
          </button>
        </div>

        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Clock className="w-5 h-5 text-slate-400" /> Today's Activity</h2>
            <button onClick={() => setShowHistoryModal(true)} className="text-sm font-bold text-cyan-600">View All</button>
          </div>
          <div className="space-y-3">
            {/* The empty array fallback prevents the `.slice` crash */}
            {(recentScans || []).slice(0, 3).map(scan => (
              <div key={scan.id} className="bg-white p-4 rounded-2xl shadow-sm flex justify-between items-center border border-slate-100">
                <div>
                  <p className="font-bold text-slate-800 text-sm">{scan.car_model_snapshot}</p>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">{scan.barcode} • {scan.created_at ? new Date(scan.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</p>
                </div>
                <span className={`text-[10px] font-black tracking-wider uppercase px-2.5 py-1 rounded-full ${scan.transaction_type === 'RESTOCK' ? 'bg-teal-50 text-teal-600' : 'bg-red-50 text-red-500'}`}>{scan.transaction_type}</span>
              </div>
            ))}
            {(!recentScans || recentScans.length === 0) && (
              <p className="text-center text-slate-400 text-sm py-6 bg-white rounded-2xl border border-slate-100 border-dashed">No scans yet today.</p>
            )}
          </div>
        </div>
      </main>

      {/* MODALS */}
      {transactionType && !scanMethod && !pendingScan && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-4 pb-10">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl animate-in slide-in-from-bottom-8">
            <h2 className="text-2xl font-black text-slate-800 mb-2">Scan Barcode</h2>
            <p className="text-slate-500 mb-6 font-medium">Action: <span className={`font-bold ${transactionType === 'RESTOCK' ? 'text-teal-600' : 'text-red-500'}`}>{transactionType === 'RESTOCK' ? 'ADD TO INVENTORY' : 'SOLD OFFLINE'}</span></p>
            <div className="flex flex-col gap-3">
              <button onClick={() => setScanMethod('camera')} className="flex items-center justify-center gap-3 w-full py-4 bg-slate-800 text-white rounded-2xl font-bold text-lg"><CameraIcon className="w-6 h-6" /> Direct Camera</button>
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-3 w-full py-4 bg-slate-100 text-slate-700 rounded-2xl font-bold text-lg"><ImageIcon className="w-6 h-6" /> Upload Image</button>
              <button onClick={() => setTransactionType(null)} className="mt-4 text-slate-400 font-bold py-2">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {scanMethod === 'camera' && (
        <div className="fixed inset-0 bg-black z-[100] flex flex-col">
          <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent">
            <span className="text-white font-bold tracking-wider">{transactionType === 'RESTOCK' ? 'SCAN TO ADD' : 'SCAN TO SELL'}</span>
            <button onClick={() => stopCamera(false)} className="p-3 bg-white/20 rounded-full text-white"><X className="w-6 h-6" /></button>
          </div>
          <div className="flex-1 flex flex-col justify-center items-center bg-black relative">
            <div id="camera-reader" className="w-full max-h-[80vh] overflow-hidden border-y-2 border-cyan-500/50"></div>
          </div>
        </div>
      )}

      {pendingScan && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl">
            <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${transactionType === 'RESTOCK' ? 'bg-teal-100 text-teal-600' : 'bg-red-100 text-red-500'}`}><CheckCircle2 className="w-8 h-8" /></div>
            <h2 className="text-2xl font-black text-slate-800 mb-2">Confirm Action</h2>
            <p className="text-slate-500 mb-6">You are about to <span className={`font-bold ${transactionType === 'RESTOCK' ? 'text-teal-600' : 'text-red-500'}`}>{transactionType === 'RESTOCK' ? 'RESTOCK' : 'SELL'}</span> item:</p>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-6">
              <p className="font-mono text-xl font-bold text-slate-800 tracking-widest">{pendingScan}</p>
            </div>
            <div className="flex gap-3">
              <button disabled={isProcessing} onClick={() => { setPendingScan(null); setTransactionType(null); }} className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-bold">Cancel</button>
              <button disabled={isProcessing} onClick={confirmTransaction} className={`flex-1 py-3.5 text-white rounded-xl font-bold shadow-lg ${transactionType === 'RESTOCK' ? 'bg-teal-600' : 'bg-red-500'} disabled:opacity-70`}>
                {isProcessing ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistoryModal && (
         <div className="fixed inset-0 bg-slate-50 z-[120] flex flex-col">
          <header className="bg-white px-6 py-4 flex items-center justify-between shadow-sm sticky top-0">
            <h2 className="text-xl font-black text-slate-800">Complete History</h2>
            <button onClick={() => setShowHistoryModal(false)} className="p-2 bg-slate-100 rounded-full text-slate-500"><X className="w-5 h-5" /></button>
          </header>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {(recentScans || []).map(scan => (
               <div key={`modal-${scan.id}`} className="bg-white p-4 rounded-2xl shadow-sm flex justify-between items-center border border-slate-100">
                 <div>
                   <p className="font-bold text-slate-800 text-sm">{scan.car_model_snapshot}</p>
                   <p className="text-xs text-slate-400 font-mono mt-0.5">{scan.barcode} • {scan.created_at ? new Date(scan.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</p>
                 </div>
                 <span className={`text-[10px] font-black tracking-wider uppercase px-2.5 py-1 rounded-full ${scan.transaction_type === 'RESTOCK' ? 'bg-teal-50 text-teal-600' : 'bg-red-50 text-red-500'}`}>{scan.transaction_type}</span>
               </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}