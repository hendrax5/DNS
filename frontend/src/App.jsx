/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Activity, 
  Lock, 
  Globe, 
  Server, 
  RefreshCw, 
  BarChart2, 
  ShieldAlert,
  CheckCircle2,
  ExternalLink
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats, setStats] = useState(null);
  const [lamanLabuh, setLamanLabuh] = useState([]);
  const [aclList, setAclList] = useState([]);
  const [rpzFeeds, setRpzFeeds] = useState([]);
  const [rpzAXFR, setRpzAXFR] = useState([]);
  const [syncInterval, setSyncInterval] = useState(1);
  const [domainForwarders, setDomainForwarders] = useState('');
  const [parentResolvers, setParentResolvers] = useState(['', '', '', '', '', '']);
  const [saveStatus, setSaveStatus] = useState({ show: false, message: '', type: '' });
  const [liveLogs, setLiveLogs] = useState([]);
  const [topAnalytics, setTopAnalytics] = useState({ clients: [], domains: [] });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        setStats(data);
      } catch (e) {
        setStats({
          qps: 125432, cache_hit_ratio: 94.2, avg_latency_ms: 42.3, cpu_usage: 23, mem_usage_mb: 4200,
          rpz_status: [{ name: "KOMINFO Trust Positif", status: "Mock", time: "Just now", records: 2400000 }]
        });
      }
    };
    fetchStats();
    const iv = setInterval(fetchStats, 2000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProto}//${window.location.host}/ws`);
    ws.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data);
        setLiveLogs(prev => [log, ...prev].slice(0, 50));
      } catch (e) {}
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    if (activeTab === 'dashboard') {
      const fetchTop = async () => {
        try {
          const res = await fetch('/api/top-analytics');
          const data = await res.json();
          setTopAnalytics({
            clients: (data.top_clients || []).sort((a,b)=>b.count-a.count).slice(0, 5),
            domains: (data.top_domains || []).sort((a,b)=>b.count-a.count).slice(0, 5)
          });
        } catch(e) {}
      };
      fetchTop();
      const iv = setInterval(fetchTop, 5000);
      return () => clearInterval(iv);
    }
  }, [activeTab]);

  const loadSettings = async () => {
    try {
      const resLL = await fetch('/api/laman-labuh');
      const dataLL = await resLL.json();
      if(dataLL.ips) setLamanLabuh(dataLL.ips.filter(Boolean));

      const resACL = await fetch('/api/acl');
      const dataACL = await resACL.json();
      if(dataACL.ips) setAclList(dataACL.ips.filter(Boolean));

      const resRPZ = await fetch('/api/rpz-feeds');
      const dataRPZ = await resRPZ.json();
      if(dataRPZ.feeds) setRpzFeeds(dataRPZ.feeds);
      if(dataRPZ.sync_interval) setSyncInterval(dataRPZ.sync_interval);

      const resAXFR = await fetch('/api/rpz-axfr');
      const dataAXFR = await resAXFR.json();
      if(dataAXFR.feeds) setRpzAXFR(dataAXFR.feeds);

      const resFwd = await fetch('/api/forwarders');
      const dataFwd = await resFwd.json();
      if(dataFwd.domain_forwarders !== undefined) setDomainForwarders(dataFwd.domain_forwarders);
      if(dataFwd.parent_resolvers) setParentResolvers(dataFwd.parent_resolvers);
    } catch(e) { console.error(e) }
  };

  useEffect(() => {
    if (activeTab === 'admin') loadSettings();
  }, [activeTab]);

  const showNotification = (message, type = 'success') => {
    setSaveStatus({ show: true, message, type });
    setTimeout(() => setSaveStatus({ show: false, message: '', type: '' }), 3000);
  };

  const saveLamanLabuh = async () => {
    try {
      const ips = lamanLabuh.map(i=>i.trim()).filter(i=>i);
      await fetch('/api/laman-labuh', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ips})
      });
      showNotification('Laman Labuh updated successfully');
    } catch(e) { showNotification('Failed to update Laman Labuh', 'error'); }
  };

  const saveACL = async () => {
    try {
      const ips = aclList.map(i=>i.trim()).filter(i=>i);
      await fetch('/api/acl', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ips})
      });
      showNotification('Access Control List (ACL) enforced');
    } catch(e) { showNotification('Failed to update ACL', 'error'); }
  };

  const saveRPZ = async () => {
    try {
      await fetch('/api/rpz-feeds', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ feeds: rpzFeeds.filter(f => f.url.trim()), sync_interval: syncInterval })
      });
      showNotification('RPZ Feeds scheduled for sync');
    } catch(e) { showNotification('Failed to update RPZ', 'error'); }
  };

  const saveAXFR = async () => {
    try {
      await fetch('/api/rpz-axfr', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ feeds: rpzAXFR.filter(f => f.master_ip.trim() && f.zone_name.trim()) })
      });
      showNotification('Native Zone IXFR Configured Successfully');
    } catch(e) { showNotification('Failed to update AXFR Masters', 'error'); }
  };

  const saveForwarders = async () => {
    try {
      await fetch('/api/forwarders', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
           domain_forwarders: domainForwarders,
           parent_resolvers: parentResolvers
        })
      });
      showNotification('Forwarding rules synchronized successfully');
    } catch(e) { showNotification('Failed to upload Forwarders', 'error'); }
  };

  const [chartData] = useState(() => Array.from({ length: 20 }).map((_, i) => ({
    time: i,
    qps: 120000 + Math.random() * 10000,
    blocked: 45000 + Math.random() * 5000,
  })));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans selection:bg-emerald-500/30">
      
      {/* Top Navigation - Enterprise Trust Authority */}
      <nav className="w-full bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-emerald-500" />
            <span className="text-xl font-bold tracking-tight text-white">NetShield<span className="text-slate-400 font-medium">Enterprise</span></span>
          </div>
          
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 cursor-pointer ${
                activeTab === 'dashboard' 
                  ? 'bg-slate-800 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Activity className="w-4 h-4 inline-block mr-2" />
              Monitoring
            </button>
            <button 
              onClick={() => setActiveTab('admin')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 cursor-pointer ${
                activeTab === 'admin' 
                  ? 'bg-slate-800 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Lock className="w-4 h-4 inline-block mr-2" />
              Security Policies
            </button>
          </div>
        </div>
      </nav>

      {/* Global Notification */}
      <div className={`fixed top-20 right-6 z-50 transition-all duration-300 transform ${saveStatus.show ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0 pointer-events-none'}`}>
        <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg ${saveStatus.type === 'error' ? 'bg-red-950/90 border-red-900/50 text-red-200' : 'bg-emerald-950/90 border-emerald-900/50 text-emerald-200'}`}>
          <CheckCircle2 className={`w-5 h-5 ${saveStatus.type === 'error' ? 'text-red-400' : 'text-emerald-400'}`} />
          <p className="font-medium text-sm">{saveStatus.message}</p>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {activeTab === 'dashboard' ? (
          <div className="space-y-6">
            <div className="flex justify-between items-end">
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">System Telemetry</h1>
                <p className="text-slate-400 text-sm mt-1">Real-time performance and threat intelligence monitoring.</p>
              </div>
              <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-md border border-emerald-500/20">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Protected & Online
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl hover:border-slate-700 transition-colors duration-200 cursor-pointer">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-slate-400 font-medium text-sm">Queries / Second</h3>
                  <Activity className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tracking-tight text-white">{stats ? stats.qps.toLocaleString() : '...'}</span>
                  <span className="text-xs text-emerald-400 font-medium">+2.4%</span>
                </div>
              </div>
              
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl hover:border-slate-700 transition-colors duration-200 cursor-pointer">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-slate-400 font-medium text-sm">Cache Hit Ratio</h3>
                  <DatabaseIcon className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tracking-tight text-white">{stats ? stats.cache_hit_ratio : '...'}%</span>
                  <span className="text-xs text-emerald-400 font-medium">Optimal</span>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl hover:border-slate-700 transition-colors duration-200 cursor-pointer">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-slate-400 font-medium text-sm">Recursive Latency</h3>
                  <Server className="w-5 h-5 text-slate-400" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tracking-tight text-white">{stats ? stats.avg_latency_ms : '...'} <span className="text-lg text-slate-500">ms</span></span>
                </div>
              </div>
            </div>

            {/* Domain Checker Widget */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex items-center justify-between gap-6">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2 mb-2">
                  <Globe className="w-4 h-4" /> Domain Diagnostics Checker
                </h3>
                <p className="text-xs text-slate-500">Ketahui secara instan apakah domain tertentu dibidik oleh RPZ/AXFR ISP/Kominfo.</p>
              </div>
              <div className="flex flex-1 items-center gap-3">
                <input 
                  type="text" 
                  id="checkDomainInput"
                  onKeyDown={e => {
                    if (e.key === 'Enter') document.getElementById('btnCheckDomain').click()
                  }}
                  placeholder="e.g. reddit.com" 
                  className="flex-1 bg-[#0b1120] border border-slate-700/50 rounded-lg px-4 py-2 text-sm font-mono text-slate-300 focus:outline-none focus:border-indigo-500/50 shadow-inner"
                />
                <button 
                  id="btnCheckDomain"
                  onClick={async () => {
                    const btn = document.getElementById('btnCheckDomain');
                    const origText = btn.innerText;
                    btn.innerText = 'Checking...';
                    try {
                      const domain = document.getElementById('checkDomainInput').value.trim();
                      if(!domain) return;
                      const res = await fetch('/api/check-domain?domain=' + encodeURIComponent(domain));
                      const data = await res.json();
                      if(data.is_blocked) {
                        showNotification(`LOCKED: ${domain} dicekal! (Dialihkan ke: ${data.resolve_to})`, 'error');
                      } else {
                        showNotification(`ALLOW: ${domain} bersih dari blokir. (${data.resolve_to || 'NXDOMAIN'})`, 'success');
                      }
                    } catch (e) {
                      showNotification('Gagal menghubungi Engine DNS', 'error');
                    } finally {
                      btn.innerText = origText;
                    }
                  }}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm text-white rounded-lg transition-colors shadow-[0_0_15px_rgba(79,70,229,0.3)] whitespace-nowrap cursor-pointer"
                >
                  Verify Domain
                </button>
              </div>
            </div>

            {/* Charts & Intel */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Traffic Chart */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-6 rounded-xl">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-200 mb-6">
                  <BarChart2 className="w-5 h-5 text-slate-400" /> Traffic Trend (60s)
                </h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorQps" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorBlocked" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 4" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="time" hide />
                      <YAxis stroke="#475569" tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} />
                      <Tooltip 
                        contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc'}}
                        cursor={{stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4'}}
                      />
                      <Area type="monotone" name="Total Queries" dataKey="qps" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorQps)" animationDuration={300} isAnimationActive={false} />
                      <Area type="monotone" name="Blocked Queries" dataKey="blocked" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorBlocked)" animationDuration={300} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Threat Feeds */}
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-200 mb-6">
                  <ShieldAlert className="w-5 h-5 text-slate-400" /> DNS RPZ Feeds
                </h3>
                <div className="flex flex-col gap-4">
                  {stats?.rpz_status?.map((feed, i) => (
                    <div key={i} className="flex flex-col p-4 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer group">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-semibold text-sm text-slate-200">{feed.name}</span>
                        <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> {feed.status}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs text-slate-500">
                        <span>{feed.records !== undefined ? feed.records.toLocaleString() + " Valid Domains" : "~2.4M Signatures"}</span>
                        <span>{feed.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Live Intelligence Stream */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl mt-6">
              <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-200 mb-4">
                <Activity className="w-5 h-5 text-emerald-400" /> Live Query Stream
              </h3>
              <div className="bg-slate-950 font-mono text-xs rounded-lg p-4 h-64 overflow-y-auto border border-slate-800">
                {liveLogs.length === 0 ? (
                  <span className="text-slate-500">Waiting for queries...</span>
                ) : (
                  liveLogs.map((log, i) => (
                    <div key={i} className="flex gap-4 py-1.5 border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20 items-center">
                      <span className="text-slate-500 w-20">{log.time ? new Date(log.time * 1000).toLocaleTimeString() : '--:--:--'}</span>
                      <span className={`w-20 font-semibold ${log.action === 'ALLOW' ? 'text-emerald-500' : (log.action === 'DROP_ACL' ? 'text-rose-500' : 'text-orange-500')}`}>{log.action}</span>
                      <span className="text-blue-400 w-32 truncate">{log.ip}</span>
                      <span className="text-slate-300 flex-1 truncate">{log.qname}</span>
                      <span className="text-slate-500 w-12 text-right">IN {log.type}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Top Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
               <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
                 <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider">Top Clients Insight</h3>
                 <div className="space-y-3">
                   {topAnalytics.clients.map((c, i) => (
                     <div key={i} className="flex justify-between items-center px-4 py-2 bg-slate-950 rounded-lg border border-slate-800/50">
                       <span className="text-blue-400 text-sm font-mono flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500"></div>{c.name}</span>
                       <span className="text-slate-300 font-medium text-sm">{c.count.toLocaleString()}</span>
                     </div>
                   ))}
                   {topAnalytics.clients.length === 0 && <span className="text-slate-500 text-sm">No data yet...</span>}
                 </div>
               </div>
               
               <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
                 <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider">Top Queried Domains</h3>
                 <div className="space-y-3">
                   {topAnalytics.domains.map((d, i) => (
                     <div key={i} className="flex justify-between items-center px-4 py-2 bg-slate-950 rounded-lg border border-slate-800/50">
                       <span className="text-slate-300 text-sm truncate pr-2 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div>{d.name}</span>
                       <span className="text-slate-400 font-medium text-sm">{d.count.toLocaleString()}</span>
                     </div>
                   ))}
                   {topAnalytics.domains.length === 0 && <span className="text-slate-500 text-sm">No data yet...</span>}
                 </div>
               </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Security Policies</h1>
              <p className="text-slate-400 text-sm mt-1">Manage network access and regulatory compliance routing.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Laman Labuh Config */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                <div className="p-6 border-b border-slate-800">
                  <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                    <Globe className="w-5 h-5 text-slate-400" />
                    Regulatory Override (Laman Labuh)
                  </h2>
                  <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                    Set the target IP addresses for traffic intercepting blocked domains. Multiple IPs act as a load-balancing pool.
                  </p>
                </div>
                
                <div className="p-6 bg-slate-950/50 flex flex-col flex-1">
                  <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-2">
                    {lamanLabuh.map((ip, i) => (
                      <div key={i} className="flex items-center gap-3 bg-[#0b1120] p-3 rounded-lg border border-slate-800/80 shadow-inner">
                        <input
                           type="text"
                           value={ip}
                           onChange={e => {
                               const next = [...lamanLabuh];
                               next[i] = e.target.value;
                               setLamanLabuh(next);
                           }}
                           className="flex-1 bg-transparent text-sm font-mono text-slate-300 focus:outline-none placeholder:text-slate-700"
                           placeholder="IP Address"
                        />
                        <button
                           onClick={() => setLamanLabuh(lamanLabuh.filter((_, idx) => idx !== i))}
                           className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer p-1"
                        >
                           ✕
                        </button>
                      </div>
                    ))}
                    <button
                        onClick={() => setLamanLabuh([...lamanLabuh, ''])}
                        className="mt-2 text-sm text-emerald-400 hover:text-emerald-300 flex items-center justify-center py-2.5 border border-dashed border-emerald-900/50 rounded-lg cursor-pointer transition-colors bg-emerald-950/10 hover:bg-emerald-950/30"
                    >
                        + Tambah IP Baru
                    </button>
                  </div>
                </div>
                <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
                  <button 
                    onClick={saveLamanLabuh}
                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors duration-200 cursor-pointer flex items-center gap-2"
                  >
                    Commit Configuration
                  </button>
                </div>
              </div>

              {/* ACL Config */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                <div className="p-6 border-b border-slate-800">
                  <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                    <Lock className="w-5 h-5 text-slate-400" />
                    Query Access Control (ACL)
                  </h2>
                  <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                    Define authorized IP subnets (CIDR) permitted to utilize this DNS resolver. Unauthorized requests are hard-dropped.
                  </p>
                </div>
                
                <div className="p-6 bg-slate-950/50 flex flex-col flex-1">
                  <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-2">
                    {aclList.map((acl, i) => (
                      <div key={i} className="flex items-center gap-3 bg-[#0b1120] p-3 rounded-lg border border-slate-800/80 shadow-inner">
                        <input
                           type="text"
                           value={acl}
                           onChange={e => {
                               const next = [...aclList];
                               next[i] = e.target.value;
                               setAclList(next);
                           }}
                           className="flex-1 bg-transparent text-sm font-mono text-slate-300 focus:outline-none placeholder:text-slate-700"
                           placeholder="CIDR (e.g. 192.168.1.0/24)"
                        />
                        <button
                           onClick={() => setAclList(aclList.filter((_, idx) => idx !== i))}
                           className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer p-1"
                        >
                           ✕
                        </button>
                      </div>
                    ))}
                    <button
                        onClick={() => setAclList([...aclList, ''])}
                        className="mt-2 text-sm text-emerald-400 hover:text-emerald-300 flex items-center justify-center py-2.5 border border-dashed border-emerald-900/50 rounded-lg cursor-pointer transition-colors bg-emerald-950/10 hover:bg-emerald-950/30"
                    >
                        + Tambah Subnet Baru
                    </button>
                  </div>
                </div>
                <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
                  <button 
                    onClick={saveACL}
                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors duration-200 cursor-pointer flex items-center gap-2"
                  >
                    Enforce ACL
                  </button>
                </div>
              </div>

              {/* RPZ Feeds Config */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                <div className="p-6 border-b border-slate-800">
                  <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                    <ShieldAlert className="w-5 h-5 text-slate-400" />
                    DNS Master Feeds
                  </h2>
                  <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                    Enter the URL to download RPZ zone files (e.g. Kominfo Trust Positif) or custom blocklists.
                  </p>
                </div>
                
                <div className="p-6 bg-slate-950/50 flex flex-col flex-1">
                  <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-2">
                    {rpzFeeds.map((feed, i) => {
                      const syncData = stats?.rpz_status?.find(s => s.url === feed.url);
                      const isError = syncData && syncData.status !== "Synced & Parsed" && syncData.status !== "Disabled" && syncData.status !== "Mock";
                      return (
                      <div key={i} className="flex items-center gap-3 bg-[#0b1120] p-3 rounded-lg border border-slate-800/80 shadow-inner flex-wrap">
                        <input
                           type="text"
                           value={feed.url}
                           onChange={e => {
                               const next = [...rpzFeeds];
                               next[i].url = e.target.value;
                               setRpzFeeds(next);
                           }}
                           className="flex-1 min-w-[200px] bg-transparent text-sm font-mono text-slate-300 focus:outline-none placeholder:text-slate-700"
                           placeholder="https://..."
                        />
                        {syncData && (
                          <div className="flex-none px-2 flex items-center gap-1.5">
                            {isError ? (
                              <span className="text-xs bg-red-500/10 text-red-400 font-semibold px-2 py-1 rounded flex items-center gap-1 shadow-sm border border-red-500/20" title={syncData.error}>
                                ⚠️ {syncData.status}
                              </span>
                            ) : syncData.status === "Synced & Parsed" ? (
                              <span className="text-xs bg-emerald-500/10 text-emerald-400 font-semibold px-2 py-1 rounded flex items-center gap-1 shadow-sm border border-emerald-500/20">
                                <CheckCircle2 className="w-3 h-3" /> {syncData.records.toLocaleString()} Baris
                              </span>
                            ) : (
                              <span className="text-xs text-slate-500 font-semibold px-2 py-1">{syncData.status}</span>
                            )}
                          </div>
                        )}
                        <button
                           onClick={() => {
                               const next = [...rpzFeeds];
                               next[i].enabled = !next[i].enabled;
                               setRpzFeeds(next);
                           }}
                           className={`px-3 py-1 rounded text-xs font-bold transition-all whitespace-nowrap ${feed.enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.15)]' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}
                        >
                           {feed.enabled ? 'ENABLED' : 'DISABLED'}
                        </button>
                        <button
                           onClick={() => setRpzFeeds(rpzFeeds.filter((_, idx) => idx !== i))}
                           className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer p-1"
                        >
                           ✕
                        </button>
                        {isError && syncData.error && (
                          <div className="w-full mt-1 text-[10px] text-red-400/80 font-mono tracking-wide px-1 truncate">
                            {syncData.error}
                          </div>
                        )}
                      </div>
                    )})}
                    <button
                        onClick={() => setRpzFeeds([...rpzFeeds, {url: '', enabled: true}])}
                        className="mt-2 text-sm text-blue-400 hover:text-blue-300 flex items-center justify-center py-2.5 border border-dashed border-blue-900/50 rounded-lg cursor-pointer transition-colors bg-blue-950/10 hover:bg-blue-950/30"
                    >
                        + Tambah URL Baru
                    </button>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
                     <span className="text-xs text-slate-400 font-bold tracking-widest uppercase">Auto Sync Interval</span>
                     <div className="flex items-center gap-2">
                        <input 
                           type="number" 
                           value={syncInterval} 
                           onChange={e => setSyncInterval(parseInt(e.target.value) || 1)}
                           className="w-16 bg-[#0b1120] border border-slate-700/50 rounded px-2 py-1.5 text-center text-sm font-mono text-indigo-300 focus:outline-none focus:border-indigo-500/50 transition-colors"
                           min="1"
                        />
                        <span className="text-xs text-slate-500 font-medium">Minutes</span>
                     </div>
                  </div>
                </div>
                <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
                  <button 
                    onClick={saveRPZ}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors duration-200 cursor-pointer flex items-center gap-2"
                  >
                    Save & Sync Feeds
                  </button>
                </div>
              </div>

              {/* AXFR Native Zone Config */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                <div className="p-6 border-b border-slate-800">
                  <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                    <DatabaseIcon className="w-5 h-5 text-indigo-400" />
                    AXFR/IXFR DNS Masters
                  </h2>
                  <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                    Native Protocol Zone Transfer directly to BSSN/Kominfo servers (bypasses HTTP syncs).
                  </p>
                </div>
                
                <div className="p-6 bg-slate-950/50 flex flex-col flex-1">
                  <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-2">
                    {rpzAXFR.map((feed, i) => (
                      <div key={i} className="flex flex-col gap-2 bg-[#0b1120] p-4 rounded-lg border border-slate-800/80 shadow-inner">
                        <div className="flex items-center gap-3">
                           <input
                              type="text"
                              value={feed.master_ip}
                              onChange={e => {
                                  const next = [...rpzAXFR];
                                  next[i].master_ip = e.target.value;
                                  setRpzAXFR(next);
                              }}
                              className="w-1/2 bg-transparent border-b border-slate-800 pb-1 text-sm font-mono text-slate-300 focus:outline-none focus:border-indigo-500 placeholder:text-slate-700"
                              placeholder="IP Master (e.g. 182.23.79.202)"
                           />
                           <input
                              type="text"
                              value={feed.zone_name}
                              onChange={e => {
                                  const next = [...rpzAXFR];
                                  next[i].zone_name = e.target.value;
                                  setRpzAXFR(next);
                              }}
                              className="w-1/2 bg-transparent border-b border-slate-800 pb-1 text-sm font-mono text-slate-300 focus:outline-none focus:border-indigo-500 placeholder:text-slate-700"
                              placeholder="Zone (e.g. trustpositifkominfo)"
                           />
                        </div>
                        <div className="flex justify-between items-center mt-2">
                           <button
                              onClick={() => {
                                  const next = [...rpzAXFR];
                                  next[i].enabled = !next[i].enabled;
                                  setRpzAXFR(next);
                              }}
                              className={`px-3 py-1 rounded text-xs font-bold transition-all whitespace-nowrap ${feed.enabled ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 shadow-[0_0_10px_rgba(79,70,229,0.15)]' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}
                           >
                              {feed.enabled ? 'PROTOCOL ENABLED' : 'DISABLED'}
                           </button>
                           <button
                              onClick={() => setRpzAXFR(rpzAXFR.filter((_, idx) => idx !== i))}
                              className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer text-xs"
                           >
                              ✕ Buang
                           </button>
                        </div>
                      </div>
                    ))}
                    <button
                        onClick={() => setRpzAXFR([...rpzAXFR, {master_ip: '', zone_name: '', enabled: false}])}
                        className="mt-2 text-sm text-indigo-400 hover:text-indigo-300 flex items-center justify-center py-2.5 border border-dashed border-indigo-900/50 rounded-lg cursor-pointer transition-colors bg-indigo-950/10 hover:bg-indigo-950/30"
                    >
                        + Tambah Master AXFR Server
                    </button>
                  </div>
                </div>
                <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
                  <button 
                    onClick={saveAXFR}
                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors duration-200 cursor-pointer flex items-center gap-2"
                  >
                    Deploy AXFR Rules
                  </button>
                </div>
              </div>

              {/* Kominfo Forwarders Config */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden lg:col-span-3">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/20">
                  <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                      <ExternalLink className="w-5 h-5 text-indigo-400" />
                      Forwarder & Parent Resolver
                    </h2>
                    <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                      Implement Conditional Forwarding policies matching the National Kominfo specifications.
                    </p>
                  </div>
                  <button 
                    onClick={saveForwarders}
                    className="px-8 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg shadow-[0_0_15px_rgba(79,70,229,0.3)] transition-all duration-200 cursor-pointer flex items-center gap-2"
                  >
                    Simpan Konfigurasi
                  </button>
                </div>
                
                <div className="p-6 bg-slate-950/50 flex flex-col lg:flex-row gap-10 flex-1">
                  
                  {/* Domain Forwarder */}
                  <div className="flex-1 flex flex-col gap-2">
                     <label className="block text-sm font-bold text-white tracking-widest uppercase">Domain Forwarder</label>
                     <p className="text-xs text-slate-400 mb-2 leading-relaxed">
                        Format: <code className="text-indigo-300 bg-indigo-900/30 px-1 py-0.5 rounded">domain_name,ip_resolver1,ip_resolver2,...</code><br/>
                        Peringatan: salah isi DNS bisa tidak berfungsi!
                     </p>
                     <textarea 
                        value={domainForwarders}
                        onChange={e => setDomainForwarders(e.target.value)}
                        className="w-full flex-1 min-h-[250px] bg-[#0b1120] border border-slate-700/50 rounded-lg p-5 text-slate-300 font-mono text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all resize-none shadow-inner leading-loose"
                        placeholder="contoh:&#10;facebook.com,8.8.8.8,8.8.4.4,1.1.1.1&#10;akamai.com,1.1.1.1@153,9.9.9.9@253"
                     />
                  </div>

                  {/* Parent Resolver */}
                  <div className="w-full lg:w-[450px] flex flex-col gap-2 border-t lg:border-t-0 lg:border-l border-slate-800 pt-6 lg:pt-0 lg:pl-10">
                     <label className="block text-sm font-bold text-white tracking-widest uppercase flex items-center gap-2">
                        Parent Resolver
                     </label>
                     <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                        Format: <code className="text-indigo-300 bg-indigo-900/30 px-1 py-0.5 rounded">ip_resolver</code> atau <code className="text-indigo-300 bg-indigo-900/30 px-1 py-0.5 rounded">ip_resolver@port</code><br/>
                        Berlaku sebagai jaring tangkap utama (Global DNS Forwarder).
                     </p>
                     <div className="space-y-4 mt-1">
                        {[0, 1, 2, 3, 4, 5].map(i => (
                           <div key={i} className="flex items-center gap-4 bg-slate-900/50 p-2 rounded-lg border border-slate-800/80 hover:border-slate-700 transition-colors">
                              <span className="text-slate-400 text-sm font-medium w-24 tracking-wide">Resolver {i+1} :</span>
                              <input 
                                 type="text"
                                 value={parentResolvers[i] || ''}
                                 onChange={(e) => {
                                    const next = [...parentResolvers];
                                    next[i] = e.target.value;
                                    setParentResolvers(next);
                                 }}
                                 className="flex-1 bg-[#0b1120] border border-slate-700/50 rounded-md px-4 py-2 text-indigo-100 font-mono text-sm focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/30 transition-all placeholder:text-slate-700"
                                 placeholder={i === 0 ? "1.2.3.4" : i === 1 ? "2.3.4.5@5353" : "::1"}
                              />
                           </div>
                        ))}
                     </div>
                  </div>

                </div>
              </div>

            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const DatabaseIcon = ({className}) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>;

export default App;
