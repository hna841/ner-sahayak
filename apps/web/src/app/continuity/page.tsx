'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/AuthProvider';
import { calcContinuityGap, continuityStatus } from '@shared/risk/calcContinuity';
import { riskCategory, CLOSURE_DAYS_BY_CATEGORY } from '@shared/risk/calcRisk';
import type { District } from '@shared/schemas/district';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-raised p-4 border border-overlay rounded-[24px]">
        <p className="font-bold text-primary mb-2">{label}</p>
        <div className="space-y-1 text-sm">
          <p className="text-accent">Buffer Stock: {data.stockBufferDays} days</p>
          <p className="text-status-watch">Expected Closure: {data.expectedClosureDays} days</p>
          <div className="pt-2 mt-2 border-t border-overlay">
            <p className="font-bold text-status-critical">Continuity Gap: {data.expectedClosureDays - data.stockBufferDays} days</p>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

export default function ContinuityPage() {
  const { user } = useAuth();
  const [districts, setDistricts] = useState<District[]>([]);

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, 'districts'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newDistricts: District[] = [];
      snapshot.forEach((doc) => {
        newDistricts.push({ id: doc.id, ...doc.data() } as District);
      });
      setDistricts(newDistricts);
    });

    return () => unsubscribe();
  }, [user]);

  if (!user) return null;

  const getStatusStyle = (status: string) => {
    if (status === 'OK') return { color: 'bg-status-clear/20 text-status-clear border-status-clear/30', icon: '🟢' };
    if (status === 'WATCH') return { color: 'bg-status-watch/20 text-status-watch border-status-watch/30', icon: '🟠' };
    return { color: 'bg-status-critical/20 text-status-critical border-status-critical/30', icon: '🔴' };
  };

  const chartData = districts.map(d => {
    const cat = riskCategory(d.currentRiskScore);
    const expectedClosureDays = CLOSURE_DAYS_BY_CATEGORY[cat];
    const gap = calcContinuityGap(d.stockBufferDays, cat);
    return {
      name: d.name.split(' ')[0], // short name for Y axis
      fullName: d.name,
      stockBufferDays: d.stockBufferDays,
      expectedClosureDays,
      continuityGap: gap
    };
  });

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold text-primary mb-8">Supply Continuity Impact</h1>

      <div className="bg-panel rounded-[24px] border border-overlay p-6 max-w-3xl mb-8">
        <h2 className="text-xl font-bold mb-6 border-b border-overlay pb-2 text-primary">Continuity Gap Overview</h2>
        {districts.length === 0 ? (
          <div className="p-8 text-center text-caption border border-overlay rounded-[12px]">
            No district data available for visualization.
          </div>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                <defs>
                  <linearGradient id="closureGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#F59E0B" />
                    <stop offset="100%" stopColor="#EF4444" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="var(--color-overlay)" />
                <XAxis type="number" tickLine={false} axisLine={{ stroke: 'var(--color-overlay)' }} tick={{ fill: 'var(--color-caption)', fontSize: 12 }} />
                <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} tick={{ fill: 'var(--color-body)', fontSize: 13, fontWeight: 700 }} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-raised)' }} />
                <Legend wrapperStyle={{ paddingTop: '10px', color: 'var(--color-body)' }} />
                <Bar dataKey="stockBufferDays" name="Buffer Stock (Days)" fill="var(--color-accent)" barSize={20} isAnimationActive={true} animationDuration={1500} animationEasing="ease-out" radius={[0, 4, 4, 0]} />
                <Bar dataKey="expectedClosureDays" name="Expected Closure (Days)" fill="url(#closureGradient)" barSize={20} isAnimationActive={true} animationDuration={1500} animationEasing="ease-out" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="bg-panel rounded-[24px] border border-overlay p-6 max-w-3xl">
        <h2 className="text-xl font-bold mb-6 border-b border-overlay pb-2 text-primary">Live District Continuity Status</h2>
        
        {districts.length === 0 ? (
          <div className="p-8 text-center text-caption border border-overlay rounded-[12px]">
            No district data available.
          </div>
        ) : (
          <div className="space-y-4">
            {districts.map((district) => {
              const cat = riskCategory(district.currentRiskScore);
              const gap = calcContinuityGap(district.stockBufferDays, cat);
              const status = continuityStatus(gap);

              return (
                <div key={district.id} className="p-5 border border-overlay rounded-[12px] hover:bg-raised transition-colors">
                  <div className="flex justify-between items-center mb-3">
                    <div>
                      <h3 className="font-bold text-lg text-primary">{district.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-sm text-caption">Connectivity:</span>
                        <select 
                          className="text-sm border border-overlay rounded px-2 py-1 outline-none bg-raised text-primary"
                          value={district.connectivityStatus}
                          onChange={async (e) => {
                            const { doc, updateDoc } = await import('firebase/firestore');
                            await updateDoc(doc(db, 'districts', district.id), {
                              connectivityStatus: e.target.value
                            });
                          }}
                        >
                          <option value="connected">Connected</option>
                          <option value="degraded">Degraded</option>
                          <option value="isolated">Isolated</option>
                        </select>
                      </div>
                    </div>
                    <span className={`px-4 py-1.5 rounded-[4px] text-sm font-bold uppercase tracking-wider border ${getStatusStyle(status).color}`}>
                      {getStatusStyle(status).icon} {status}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-overlay">
                    <div>
                      <p className="text-xs text-caption uppercase tracking-[0.7em] mb-1">Risk Score</p>
                      <div className="flex items-center gap-2">
                        <input 
                          type="range" 
                          min="0" max="1" step="0.05"
                          className="w-20 accent-accent"
                          value={district.currentRiskScore}
                          onChange={async (e) => {
                            const { doc, updateDoc } = await import('firebase/firestore');
                            await updateDoc(doc(db, 'districts', district.id), {
                              currentRiskScore: parseFloat(e.target.value)
                            });
                          }}
                        />
                        <p className="font-mono font-medium text-sm text-primary">
                          {(district.currentRiskScore * 100).toFixed(0)}% <span className="text-caption">({cat})</span>
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-caption uppercase tracking-[0.7em] mb-1">Buffer Stock</p>
                      <div className="flex items-center gap-2">
                        <input 
                          type="number" 
                          min="0" max="30"
                          className="w-16 text-sm border border-overlay rounded px-1 outline-none font-mono bg-raised text-primary"
                          value={district.stockBufferDays}
                          onChange={async (e) => {
                            const { doc, updateDoc } = await import('firebase/firestore');
                            await updateDoc(doc(db, 'districts', district.id), {
                              stockBufferDays: parseInt(e.target.value, 10)
                            });
                          }}
                        />
                        <span className="font-mono font-medium text-sm text-primary">days</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-caption uppercase tracking-[0.7em] mb-1">Continuity Gap</p>
                      <p className={`font-mono font-bold ${gap < 0 ? 'text-status-critical' : gap <= 2 ? 'text-status-watch' : 'text-status-clear'}`}>
                        {gap > 0 ? '+' : ''}{gap} days
                      </p>
                    </div>
                  </div>
                  
                  <div className="text-xs text-caption mt-3 text-right">
                    Last updated: {new Date(district.lastUpdated).toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
