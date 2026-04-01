const fs = require('fs');

const appFile = 'src/App.jsx';
let content = fs.readFileSync(appFile, 'utf8');

// Update imports
content = content.replace(
  "import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';",
  "import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';"
);

// We want to replace the dashboard block.
const startMarker = "          {activeTab === 'dashboard' ? (";
const endMarker = "        ) : activeTab === 'admin' && isAuthenticated ? (";

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error("Markers not found!");
  process.exit(1);
}

// Generate the new dashboard UI matching the ASCII NOC-Grade
const newDashboardUI = `          {activeTab === 'dashboard' ? (
            <div className="space-y-6 flex flex-col h-full animate-fadeIn transition-all">
              {/* Row 1: KPI Tiles */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col items-center justify-center relative overflow-hidden group">
                  <div className="absolute -inset-0 bg-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity blur-xl pointer-events-none"></div>
                  <Globe className="w-5 h-5 text-blue-400 mb-2" />
                  <span className="text-3xl font-bold text-white tracking-tight">{stats?.qps?.toLocaleString() || 0}</span>
                  <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider mt-1">Total Query / Sec</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col items-center justify-center relative overflow-hidden group">
                  <div className="absolute -inset-0 bg-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity blur-xl pointer-events-none"></div>
                  <Activity className="w-5 h-5 text-indigo-400 mb-2" />
                  <span className="text-3xl font-bold text-white tracking-tight">{stats?.avg_latency_ms || 0}<span className="text-lg text-slate-400 ml-1">ms</span></span>
                  <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider mt-1">Avg Response</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col items-center justify-center relative overflow-hidden group">
                  <div className="absolute -inset-0 bg-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity blur-xl pointer-events-none"></div>
                  <Database className="w-5 h-5 text-emerald-400 mb-2" />
                  <span className="text-3xl font-bold text-white tracking-tight">{stats?.cache_hit_ratio || 0}<span className="text-lg text-slate-400 ml-1">%</span></span>
                  <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider mt-1">Cache Efficiency</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col items-center justify-center relative overflow-hidden group">
                  <div className="absolute -inset-0 bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-opacity blur-xl pointer-events-none"></div>
                  <ShieldBan className="w-5 h-5 text-rose-500 mb-2" />
                  <span className="text-3xl font-bold text-rose-400 tracking-tight">{topAnalytics.blocked.reduce((a,b)=>a+b.count,0).toLocaleString()}</span>
                  <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider mt-1">Threats Blocked</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col items-center justify-center relative overflow-hidden group">
                  <div className="absolute -inset-0 bg-amber-500/10 opacity-0 group-hover:opacity-100 transition-opacity blur-xl pointer-events-none"></div>
                  <Cpu className="w-5 h-5 text-amber-500 mb-2" />
                  <span className="text-3xl font-bold text-white tracking-tight">{stats?.cpu_usage || 0}<span className="text-lg text-slate-400 ml-1">%</span></span>
                  <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider mt-1">{stats?.mem_usage_mb || 0} MB RAM</span>
                </div>
              </div>

              {/* Row 2: Time Series */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col shadow-lg">
                  <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-blue-400" /> Query Volume Trend (QPS)
                  </h3>
                  <div className="h-[250px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={stats?.history_series || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorQpsV3" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis dataKey="time" stroke="#475569" tick={{fill: '#64748b', fontSize: 11}} axisLine={false} tickLine={false} />
                        <YAxis stroke="#475569" tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', fontSize: '13px'}} />
                        <Area type="monotone" name="QPS" dataKey="qps" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorQpsV3)" isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col shadow-lg">
                  <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4 text-indigo-400" /> Latency & Efficiency Trend
                  </h3>
                  <div className="h-[250px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={stats?.history_series || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorLat" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis dataKey="time" stroke="#475569" tick={{fill: '#64748b', fontSize: 11}} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="left" stroke="#818cf8" tick={{fill: '#818cf8', fontSize: 12}} axisLine={false} tickLine={false} tickFormatter={(v)=>\`\${v}ms\`} />
                        <YAxis yAxisId="right" orientation="right" stroke="#34d399" tick={{fill: '#34d399', fontSize: 12}} axisLine={false} tickLine={false} domain={[0,100]} tickFormatter={(v)=>\`\${v}%\`} />
                        <Tooltip contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', fontSize: '13px'}} />
                        <Area yAxisId="left" type="monotone" name="Latency (ms)" dataKey="latency" stroke="#818cf8" strokeWidth={2} fillOpacity={1} fill="url(#colorLat)" isAnimationActive={false} />
                        <Area yAxisId="right" type="monotone" name="Cache Hit (%)" dataKey="cacheRatio" stroke="#34d399" strokeDasharray="4 4" fill="none" strokeWidth={2} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Row 3: Distributions & Security Alerts */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-lg flex flex-col">
                  <h3 className="text-sm font-semibold text-slate-400 mb-2 uppercase tracking-wider flex items-center gap-2">Response Codes</h3>
                  <div className="flex-1 min-h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={[
                          {name: 'NOERROR', value: stats?.response_codes?.NOERROR || 1},
                          {name: 'NXDOMAIN', value: stats?.response_codes?.NXDOMAIN || 0},
                          {name: 'SERVFAIL', value: stats?.response_codes?.SERVFAIL || 0}
                        ]} cx="50%" cy="50%" innerRadius={60} outerRadius={80} dataKey="value" stroke="none">
                          <Cell fill="#10b981" />
                          <Cell fill="#f59e0b" />
                          <Cell fill="#ef4444" />
                        </Pie>
                        <Tooltip contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '12px'}} />
                        <Legend verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{fontSize: '11px', color: '#94a3b8'}} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-lg flex flex-col">
                  <h3 className="text-sm font-semibold text-slate-400 mb-2 uppercase tracking-wider flex items-center gap-2">L4/L7 Protocol Types</h3>
                  <div className="flex-1 min-h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={Object.entries(stats?.query_types || {'A':1}).map(([k,v]) => ({name: k, value: v}))} cx="50%" cy="50%" innerRadius={0} outerRadius={80} dataKey="value" stroke="none">
                          {Object.entries(stats?.query_types || {}).map((entry, index) => (
                            <Cell key={\`cell-\${index}\`} fill={['#3b82f6', '#8b5cf6', '#0ea5e9', '#ec4899', '#f97316'][index % 5]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '12px'}} />
                        <Legend verticalAlign="bottom" align="center" wrapperStyle={{fontSize: '11px', color: '#94a3b8'}} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-lg overflow-hidden flex flex-col h-[280px]">
                  <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider flex items-center justify-between">
                    <span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-rose-500" /> DNS Anomaly Sentinel</span>
                    <span className="text-[10px] bg-rose-500/20 text-rose-400 px-2 py-0.5 rounded border border-rose-500/30 font-bold animate-pulse">LIVE</span>
                  </h3>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {stats?.telemetry_alerts?.length > 0 ? stats.telemetry_alerts.map((a, i) => (
                      <div key={i} className={\`p-3 rounded-lg border text-xs leading-relaxed \${a.Level === 'CRIT' ? 'bg-rose-500/10 border-rose-500/30 text-rose-200' : 'bg-amber-500/10 border-amber-500/30 text-amber-200'}\`}>
                         <div className="mb-1 flex justify-between">
                            <span className={\`font-bold \${a.Level === 'CRIT' ? 'text-rose-400' : 'text-amber-400'}\`}>[{a.Level}] ANOMALY</span>
                            <span className="opacity-70 font-mono text-[10px]">{a.Time}</span>
                         </div>
                         {a.Message}
                      </div>
                    )) : (
                      <div className="flex h-full flex-col items-center justify-center text-slate-500 space-y-2 opacity-50">
                         <ShieldCheck className="w-8 h-8 text-emerald-500" />
                         <span className="text-xs font-medium">No Anomalies Detected. Network Secure.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 4: Custom Dig Monitor & Subnets */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
               <div className="bg-[#0f172a] shadow-lg border border-slate-800 p-6 rounded-xl flex flex-col h-full">
                 <h3 className="text-sm font-semibold text-slate-400 mb-1 uppercase tracking-wider flex items-center gap-2">
                   <Globe className="w-4 h-4 text-indigo-400" />
                   Upstream Health Monitor
                 </h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                     {digHealth.map((d, i) => (
                         <div key={i} className="flex flex-col bg-[#0b1120] border border-slate-800 p-4 rounded-xl relative overflow-hidden group">
                             <div className={\`absolute top-0 right-0 w-16 h-16 blur-2xl opacity-10 \${d.status === 'OK' ? 'bg-emerald-500' : 'bg-rose-500'}\`}></div>
                             <span className="text-xs text-slate-400 mb-1 truncate">{d.domain}</span>
                             <div className="flex items-end gap-2">
                                <span className={\`text-3xl font-bold font-mono tracking-tight \${d.status === 'OK' ? 'text-white' : 'text-rose-400'}\`}>
                                    {d.status === 'OK' ? d.latency : 'ERR'}
                                </span>
                                <span className="text-slate-500 text-sm font-semibold mb-1">ms</span>
                             </div>
                             <div className="mt-3 flex items-center gap-1.5">
                                 <span className="relative flex h-2 w-2">
                                    <span className={\`absolute inline-flex h-full w-full rounded-full opacity-75 \${d.status === 'OK' ? 'animate-ping bg-emerald-400' : 'bg-rose-500'}\`}></span>
                                    <span className={\`relative inline-flex rounded-full h-2 w-2 \${d.status === 'OK' ? 'bg-emerald-500' : 'bg-rose-500'}\`}></span>
                                 </span>
                                 <span className={\`text-[10px] font-bold tracking-wider uppercase \${d.status === 'OK' ? 'text-emerald-500' : 'text-rose-500'}\`}>
                                     {d.status === 'OK' ? 'RESOLVED' : 'TIMEOUT'}
                                 </span>
                             </div>
                         </div>
                     ))}
                     {digHealth.length === 0 && <span className="text-slate-500 text-sm italic col-span-2 text-center p-6 border border-dashed border-slate-800 rounded-lg">Monitoring targets pending...</span>}
                 </div>
               </div>

               <div className="flex flex-col gap-6">
                 <div className="bg-[#0f172a] border border-slate-800 p-6 rounded-xl shadow-lg">
                   <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider">Top Access Blocked (Global Lists)</h3>
                   <div className="space-y-3">
                     {topAnalytics.blocked.map((d, i) => (
                       <div key={i} className="flex justify-between items-center px-4 py-2 bg-[#0b1120] rounded-lg border border-slate-800/50">
                         <span className="text-rose-200 text-sm truncate pr-2 font-mono flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>{d.name}</span>
                         <span className="text-rose-400 font-bold bg-rose-500/10 px-2 rounded text-xs border border-rose-500/20">{d.count.toLocaleString()} x</span>
                       </div>
                     ))}
                     {topAnalytics.blocked.length === 0 && <span className="text-slate-500 text-sm">Validating zero threats...</span>}
                   </div>
                 </div>
                 
                 <div className="bg-[#0f172a] border border-slate-800 p-6 rounded-xl shadow-lg">
                   <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider">Top Subnet Actors (Clients)</h3>
                   <div className="space-y-3">
                     {topAnalytics.clients.map((c, i) => (
                       <div key={i} className="flex justify-between items-center px-4 py-2 bg-[#0b1120] rounded-lg border border-slate-800/50">
                         <span className="text-blue-300 text-sm font-mono flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>{c.name}</span>
                         <div className="flex gap-2 text-[10px] font-bold tracking-wider">
                           <span className="text-emerald-400 text-right">{c.allow ? c.allow.toLocaleString() : 0} OK</span> | 
                           <span className="text-rose-400">{c.block ? c.block.toLocaleString() : 0} DROP</span>
                         </div>
                       </div>
                     ))}
                     {topAnalytics.clients.length === 0 && <span className="text-slate-500 text-sm">Gathering...</span>}
                   </div>
                 </div>
               </div>
              </div>
            </div>
`;

content = content.substring(0, startIndex) + newDashboardUI + "\n" + content.substring(endIndex);
fs.writeFileSync(appFile, content);
console.log('App.jsx dashboard overhauled completely.');
