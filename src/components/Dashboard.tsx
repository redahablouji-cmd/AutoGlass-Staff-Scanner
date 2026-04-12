import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode'; 
import { supabase } from '../supabaseClient';
import { Plus, Minus, LogOut, Clock, X, CheckCircle2, Camera as CameraIcon, Image as ImageIcon } from 'lucide-react';

interface DashboardProps {
  onLogout: () => void;
}

export default function Dashboard({ onLogout }: DashboardProps) {
  // --- STATE MACHINE ---
  const [transactionType, setTransactionType] = useState<'RESTOCK' | 'SOLD_OFFLINE' | null>(null);
  const [scanMethod, setScanMethod] = useState<'camera' | null>(null);
  const [pendingScan, setPendingScan] = useState<string | null>(null);
  
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recentScans, setRecentScans] = useState<any[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sessionData = JSON.parse(localStorage.getItem('staff_session') || '{}');
  const staffName = sessionData.first_name || "Staff";

  // --- FULL SCREEN CAMERA LOGIC ---
  useEffect(() => {
    if (scanMethod === 'camera') {
      const scanner = new Html5Qrcode("camera-reader");
      scannerRef.current = scanner;

      scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 300, height: 150 } },
        (decodedText) => {
          // SUCCESS: Pass 'true' so we don't erase the Add/Sell choice!
          stopCamera(true);
          setPendingScan(decodedText);
        },
        (error) => { /* Ignore background scanning errors */ }
      ).catch((err) => {
        console.error("Camera Error:", err);
        alert("Could not start the camera. Please check browser permissions.");
        stopCamera(false);
      });
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().then(() => scannerRef.current?.clear()).catch(console.error);
      }
    };
  }, [scanMethod]);

  const stopCamera = (isSuccess = false) => {
    if (scannerRef.current) {
      scannerRef.current.stop().then(() => {
        scannerRef.current?.clear();
        scannerRef.current = null;
      }).catch(console.error);
    }
    setScanMethod(null);
    
    // Only erase the Add/Sell choice if the user clicked Cancel
    if (!isSuccess) {
      setTransactionType(null); 
    }
  };

  // --- IMAGE FILE LOGIC ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const html5QrCode = new Html5Qrcode("hidden-file-reader");
    try {
      const decodedText = await html5QrCode.scanFile(file, true);
      setPendingScan(decodedText);
      // We keep the transaction type alive here too!
    } catch (err) {
      alert("Could not find a clear barcode in this image. Please try another one.");
      setTransactionType(null);
    }
    
    if (fileInputRef.current) fileInputRef.current.value = ''; 
  };

  // --- FETCH HISTORY ---
  useEffect(() => {
    const fetchHistory = async () => {
      if (!sessionData.boss_id) return;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data } = await supabase
        .from('inventory_transactions')
        .select('*')
        .eq('staff_scanner_id', sessionData.scanner_id)
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false });

      if (data) setRecentScans(data);
    };
    fetchHistory();
  }, [refreshTrigger]); // <--- CHANGE THIS WORD

  // --- CONFIRM & SAVE TO DATABASE ---
  // --- CONFIRM & SAVE TO DATABASE ---
  const confirmTransaction = async () => {
    if (!pendingScan || !sessionData.boss_id || !transactionType) return;
    setIsProcessing(true);

    try {
      // 1. Check live_inventory using exact column name: factory_barcode
      const { data: inventoryItem, error: invError } = await supabase
        .from('live_inventory')
        .select('*')
        .eq('boss_id', sessionData.boss_id)
        .eq('factory_barcode', pendingScan) 
        .maybeSingle();

      if (invError) console.error("Inventory Fetch Error:", invError);

      let finalCarName = "Unknown Vehicle";

      if (inventoryItem) {
        // --- SCENARIO A: ITEM FOUND -> UPDATE QUANTITY ---
        finalCarName = inventoryItem.master_sku || inventoryItem.car_model || "Auto Glass";
        
        const newQuantity = transactionType === 'RESTOCK' 
          ? inventoryItem.quantity + 1 
          : Math.max(0, inventoryItem.quantity - 1); // Prevents negative numbers
        
        const { error: updateError } = await supabase
          .from('live_inventory')
          .update({ quantity: newQuantity })
          .eq('boss_id', sessionData.boss_id)
          .eq('factory_barcode', pendingScan);

        if (updateError) {
          alert("Database Blocked the Quantity Update: " + updateError.message);
          setIsProcessing(false);
          return;
        }

      } else {
        // --- SCENARIO B: ITEM NOT FOUND -> INSERT NEW ROW ---
        if (transactionType === 'SOLD_OFFLINE') {
          alert("Cannot sell: This barcode is not in your inventory yet.");
          setIsProcessing(false);
          return;
        }

        // Look up the name in the Master Dictionary
        const { data: dictItem, error: dictError } = await supabase
          .from('barcode_dictionary')
          .select('master_sku')
          .eq('factory_barcode', pendingScan)
          .maybeSingle();

        if (!dictItem) {
          alert("Unrecognized Barcode! Not found in Master Dictionary.");
          setIsProcessing(false);
          return;
        }

        finalCarName = dictItem.master_sku;

        // Insert brand new row using factory_barcode
        const { error: insertError } = await supabase
          .from('live_inventory')
          .insert([{
            boss_id: sessionData.boss_id,
            factory_barcode: pendingScan, 
            master_sku: dictItem.master_sku, 
            quantity: 1
          }]);

        if (insertError) {
          alert("Database Blocked New Item Insert: " + insertError.message);
          setIsProcessing(false);
          return;
        }
      }

      // 3. Write to the History Ledger
      const { error: ledgerError } = await supabase
        .from('inventory_transactions')
        .insert([{
          boss_id: sessionData.boss_id,
          staff_scanner_id: sessionData.scanner_id,
          barcode: pendingScan,
          car_model_snapshot: finalCarName,
          transaction_type: transactionType
        }]);

      if (ledgerError) console.error("Ledger Error:", ledgerError);

      // Success cleanup & trigger UI Refresh
      setPendingScan(null);
      setTransactionType(null);
      setRefreshTrigger(prev => prev + 1); // Forces the History list to update instantly
      
    } catch (err) {
      console.error("Critical Transaction Error:", err);
      alert("A critical error occurred processing this scan.");
    } finally {
      setIsProcessing(false);
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
      <div id="hidden-file-reader" style={{ display: 'none' }}></div>
      <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      <header className="bg-white px-6 py-4 flex justify-between items-center shadow-sm">
        <div>
          <h1 className="text-xl font-black text-slate-800 tracking-tight">AutoGlass Staff</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{staffName}</p>
        </div>
        <button onClick={handleLogoutClick} className="p-2 text-slate-400 hover:text-red-500 bg-slate-50 rounded-full transition-colors">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      <main className="p-6 max-w-md mx-auto space-y-8 mt-4">
        <div className="flex flex-col gap-4">
          <button 
            onClick={() => setTransactionType('RESTOCK')}
            className="w-full py-6 flex items-center justify-center gap-3 rounded-2xl bg-teal-500 text-white font-black text-xl shadow-lg shadow-teal-500/30 hover:bg-teal-600 transition-all active:scale-95"
          >
            <Plus className="w-7 h-7" /> ADD TO INVENTORY
          </button>
          
          <button 
            onClick={() => setTransactionType('SOLD_OFFLINE')}
            className="w-full py-6 flex items-center justify-center gap-3 rounded-2xl bg-red-500 text-white font-black text-xl shadow-lg shadow-red-500/30 hover:bg-red-600 transition-all active:scale-95"
          >
            <Minus className="w-7 h-7" /> SOLD OFFLINE
          </button>
        </div>

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
            <p className="text-slate-500 mb-6 font-medium">
              Action: <span className={`font-bold ${transactionType === 'RESTOCK' ? 'text-teal-600' : 'text-red-500'}`}>{transactionType === 'RESTOCK' ? 'ADD TO INVENTORY' : 'SOLD OFFLINE'}</span>
            </p>
            <div className="flex flex-col gap-3">
              <button onClick={() => setScanMethod('camera')} className="flex items-center justify-center gap-3 w-full py-4 bg-slate-800 text-white rounded-2xl font-bold text-lg hover:bg-slate-900">
                <CameraIcon className="w-6 h-6" /> Direct Camera
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-3 w-full py-4 bg-slate-100 text-slate-700 rounded-2xl font-bold text-lg hover:bg-slate-200">
                <ImageIcon className="w-6 h-6" /> Upload Image
              </button>
              <button onClick={() => setTransactionType(null)} className="mt-4 text-slate-400 font-bold hover:text-slate-600 py-2">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {scanMethod === 'camera' && (
        <div className="fixed inset-0 bg-black z-[100] flex flex-col">
          <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent">
            <span className="text-white font-bold tracking-wider">
              {transactionType === 'RESTOCK' ? 'SCAN TO ADD' : 'SCAN TO SELL'}
            </span>
            {/* THIS BUTTON PASSES FALSE SO IT CANCELS PROPERLY */}
            <button onClick={() => stopCamera(false)} className="p-3 bg-white/20 hover:bg-white/30 rounded-full text-white backdrop-blur-md transition-all">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="flex-1 flex flex-col justify-center items-center bg-black relative">
            <div id="camera-reader" className="w-full max-h-[80vh] overflow-hidden border-y-2 border-cyan-500/50"></div>
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-[80%] h-[20%] border-2 border-cyan-400 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]"></div>
            </div>
          </div>
        </div>
      )}

      {pendingScan && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl">
            <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${transactionType === 'RESTOCK' ? 'bg-teal-100 text-teal-600' : 'bg-red-100 text-red-500'}`}>
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-black text-slate-800 mb-2">Confirm Action</h2>
            <p className="text-slate-500 mb-6">
              You are about to <span className={`font-bold ${transactionType === 'RESTOCK' ? 'text-teal-600' : 'text-red-500'}`}>{transactionType === 'RESTOCK' ? 'RESTOCK' : 'SELL'}</span> item:
            </p>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-6">
              <p className="font-mono text-xl font-bold text-slate-800 tracking-widest">{pendingScan}</p>
            </div>
            <div className="flex gap-3">
              <button disabled={isProcessing} onClick={() => { setPendingScan(null); setTransactionType(null); }} className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200">
                Cancel
              </button>
              <button disabled={isProcessing} onClick={confirmTransaction} className={`flex-1 py-3.5 text-white rounded-xl font-bold shadow-lg ${transactionType === 'RESTOCK' ? 'bg-teal-600 shadow-teal-600/20' : 'bg-red-500 shadow-red-500/20'} disabled:opacity-70`}>
                {isProcessing ? 'Processing...' : `Confirm ${transactionType === 'RESTOCK' ? 'Add' : 'Sale'}`}
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
            {recentScans.map(scan => (
               <div key={`modal-${scan.id}`} className="bg-white p-4 rounded-2xl shadow-sm flex justify-between items-center border border-slate-100">
                 <div>
                   <p className="font-bold text-slate-800 text-sm">{scan.car_model_snapshot}</p>
                   <p className="text-xs text-slate-400 font-mono mt-0.5">{scan.barcode} • {new Date(scan.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
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