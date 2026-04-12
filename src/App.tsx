import React, { useState } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import { AnimatePresence, motion } from 'motion/react';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50">
      <AnimatePresence mode="wait">
        {!isAuthenticated ? (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <Login onLogin={() => setIsAuthenticated(true)} />
          </motion.div>
        ) : (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Dashboard onLogout={() => setIsAuthenticated(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

